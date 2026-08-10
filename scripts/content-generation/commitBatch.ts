import type { SupabaseClient } from '@supabase/supabase-js'
import type { GrammarItem, VocabItem } from './schemas'
import { VOCAB_TAG_CODES } from './vocabTagCodes'

export interface CommitBatchDeps {
  supabase: SupabaseClient
}

export interface CommitBatchResult {
  committedCount: number
  failedCount: number
}

interface CommittableItem {
  id: string
  raw_payload: unknown
}

/**
 * category_codeを小文字に正規化してから照合する。grammar_categories.codeは常に小文字だが、
 * Geminiが生成する`category_code`のcasingは`{{category_code}}`をそのまま埋め込んだプロンプトを
 * 与えていても稀に大文字化してしまうことがある（実データで確認済み: あるバッチの15件全てが
 * "SUBJUNCTIVE"のように出力された）。Postgresの文字列比較は大文字小文字を区別するため、
 * 正規化しないと該当カテゴリが見つからずコミットに失敗する。
 *
 * 完全一致（casing正規化後）で見つからない場合は、略称ゆれを想定したfallbackを行う
 * （20260810の文法バックフィルで、Geminiが"comparison"を"COMP"のように省略して出力し、
 * comparison/difficulty=5の10件全てがneeds_reviewに道連れになった実例がある。プロンプト側
 * にも対策を入れているが（8.3参照）、すり抜けた場合の保険としてここでも救済する）。
 * grammar_categoriesは9件の固定クローズドセット（4章）で、実データ上どの2つのcodeも
 * 互いの接頭辞にならないため、前方一致による曖昧さは生じない。
 */
async function resolveCategoryId(
  supabase: SupabaseClient,
  cache: Map<string, number>,
  categoryCode: string,
): Promise<number> {
  const normalizedCode = categoryCode.trim().toLowerCase()
  const cached = cache.get(normalizedCode)
  if (cached !== undefined) return cached

  const { data, error } = await supabase
    .from('grammar_categories')
    .select('id')
    .eq('code', normalizedCode)
    .maybeSingle()
  if (error) throw error
  if (data) {
    const id = (data as { id: number }).id
    cache.set(normalizedCode, id)
    return id
  }

  const { data: allCategories, error: allError } = await supabase.from('grammar_categories').select('id, code')
  if (allError) throw allError

  const matches = ((allCategories ?? []) as { id: number; code: string }[]).filter(
    (c) => c.code.startsWith(normalizedCode) || normalizedCode.startsWith(c.code),
  )

  if (matches.length === 1) {
    const id = matches[0].id
    cache.set(normalizedCode, id)
    return id
  }

  throw new Error(
    matches.length === 0
      ? `category_code "${categoryCode}" はgrammar_categories.codeのいずれとも一致しません`
      : `category_code "${categoryCode}" が複数のカテゴリと曖昧に一致しました: ${matches.map((m) => m.code).join(', ')}`,
  )
}

async function commitGrammarItem(
  supabase: SupabaseClient,
  batchId: string,
  item: CommittableItem,
  categoryIdCache: Map<string, number>,
): Promise<string> {
  const payload = item.raw_payload as GrammarItem
  const categoryId = await resolveCategoryId(supabase, categoryIdCache, payload.category_code)

  const { data, error } = await supabase
    .from('grammar_questions')
    .insert({
      category_id: categoryId,
      question_text: payload.question_text,
      choices: payload.choices,
      correct_index: payload.correct_index,
      explanation: payload.explanation,
      difficulty: payload.difficulty,
      batch_id: batchId,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * 16.3: 既存タグ（name一致）があればそのidをそのまま使う（codeには触れない）。
 * 新規タグを作る場合のみ、VOCAB_TAG_CODESからcodeを解決してINSERTする。
 * マッピングに無い名前は、未登録のタグでcodeがnullのまま作られてしまうのを防ぐため
 * エラーで止める（呼び出し元のcommitVocabItem→commitBatchのアイテム単位のcatchでneeds_reviewに落ちる）。
 */
async function resolveTagId(supabase: SupabaseClient, tagName: string): Promise<number> {
  const { data: existing, error: selectError } = await supabase
    .from('vocab_tags')
    .select('id')
    .eq('name', tagName)
    .maybeSingle()
  if (selectError) throw selectError
  if (existing) return (existing as { id: number }).id

  const code = VOCAB_TAG_CODES[tagName]
  if (!code) {
    throw new Error(`未登録のタグ名です。vocabTagCodes.tsにcodeを追加してください: ${tagName}`)
  }

  const { data: inserted, error: insertError } = await supabase
    .from('vocab_tags')
    .insert({ name: tagName, code })
    .select('id')
    .single()
  if (insertError) throw insertError
  return (inserted as { id: number }).id
}

async function commitVocabItem(supabase: SupabaseClient, batchId: string, item: CommittableItem): Promise<string> {
  const payload = item.raw_payload as VocabItem

  const { data, error } = await supabase
    .from('vocab_words')
    .insert({
      word: payload.word,
      part_of_speech: payload.part_of_speech,
      meaning_ja: payload.meaning_ja,
      example_sentence_en: payload.example_sentence_en,
      example_sentence_ja: payload.example_sentence_ja,
      toeic_band: payload.toeic_band,
      etymology_note: payload.etymology_note,
      batch_id: batchId,
    })
    .select('id')
    .single()
  if (error) throw error
  const vocabWordId = (data as { id: string }).id

  for (const tagName of payload.tags) {
    const tagId = await resolveTagId(supabase, tagName)
    const { error: linkError } = await supabase
      .from('vocab_word_tags')
      .insert({ vocab_word_id: vocabWordId, tag_id: tagId })
    if (linkError) throw linkError
  }

  return vocabWordId
}

/**
 * 8.6: `auto_passed`/`approved`のアイテムを`grammar_questions`/`vocab_words`へ反映し、
 * 集計（committed_count/needs_review_count/rejected_count）を更新する。全アイテムが
 * committed/rejectedになった時点で`generation_batches.status = 'completed'`にする。
 */
export async function commitBatch(batchId: string, deps: CommitBatchDeps): Promise<CommitBatchResult> {
  const { supabase } = deps

  const { data: batchRow, error: batchError } = await supabase
    .from('generation_batches')
    .select('content_type')
    .eq('id', batchId)
    .single()
  if (batchError) throw batchError
  const contentType = (batchRow as { content_type: 'grammar' | 'vocab' }).content_type

  const { data: itemRows, error: itemsError } = await supabase
    .from('generation_batch_items')
    .select('id, raw_payload')
    .eq('batch_id', batchId)
    .in('status', ['auto_passed', 'approved'])
  if (itemsError) throw itemsError

  const items = (itemRows ?? []) as CommittableItem[]
  const categoryIdCache = new Map<string, number>()

  let committedCount = 0
  let failedCount = 0

  for (const item of items) {
    try {
      const committedId =
        contentType === 'grammar'
          ? await commitGrammarItem(supabase, batchId, item, categoryIdCache)
          : await commitVocabItem(supabase, batchId, item)

      const { error: updateError } = await supabase
        .from('generation_batch_items')
        .update({ status: 'committed', committed_id: committedId })
        .eq('id', item.id)
      if (updateError) throw updateError
      committedCount += 1
    } catch (error) {
      // 個別アイテムの失敗はneeds_reviewに戻し、バッチ全体は継続する
      // エラーメッセージはError.messageを優先して抽出する。素の`String(error)`は
      // PostgrestErrorのようなプレーンオブジェクトに対して"[object Object]"になり、
      // 原因調査にSQLで実データを確認し直す必要が生じていた（20260812発見の実例）。
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error)
      console.error(`item ${item.id} のコミットに失敗しました:`, error)
      await supabase
        .from('generation_batch_items')
        .update({
          status: 'needs_review',
          validation_errors: [`コミット時にエラーが発生しました: ${errorMessage}`],
        })
        .eq('id', item.id)
      failedCount += 1
    }
  }

  // committed_count等はこの実行分の差分ではなく、バッチ全体の現在値を数え直す
  // （commit_batch.tsを複数回に分けて実行しても正しい集計になるようにするため）。
  const { count: committedTotalCount, error: committedError } = await supabase
    .from('generation_batch_items')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('status', 'committed')
  if (committedError) throw committedError

  const { count: needsReviewCount, error: needsReviewError } = await supabase
    .from('generation_batch_items')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('status', 'needs_review')
  if (needsReviewError) throw needsReviewError

  const { count: rejectedCount, error: rejectedError } = await supabase
    .from('generation_batch_items')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('status', 'rejected')
  if (rejectedError) throw rejectedError

  const { count: remainingCount, error: remainingError } = await supabase
    .from('generation_batch_items')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .not('status', 'in', '(committed,rejected)')
  if (remainingError) throw remainingError

  const { error: finalizeError } = await supabase
    .from('generation_batches')
    .update({
      committed_count: committedTotalCount ?? 0,
      needs_review_count: needsReviewCount ?? 0,
      rejected_count: rejectedCount ?? 0,
      status: (remainingCount ?? 0) === 0 ? 'completed' : 'needs_review',
    })
    .eq('id', batchId)
  if (finalizeError) throw finalizeError

  return { committedCount, failedCount }
}
