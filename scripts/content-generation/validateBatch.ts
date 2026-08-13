import type { SupabaseClient } from '@supabase/supabase-js'
import { findSimilarGrammarQuestions, findSimilarVocabWords } from './duplicateCheck'
import { runGrammarSelfCheck } from './selfCheck'
import {
  validateAdditionalExplanationItemStructure,
  validateGrammarItemStructure,
  validateVocabItemStructure,
  wordPosKey,
} from './structuralValidation'
import type { generateJson as generateJsonFn } from './gemini'

type ContentType = 'grammar' | 'vocab' | 'grammar_explanation' | 'vocab_explanation'

export interface ValidateBatchDeps {
  supabase: SupabaseClient
  generateJson: typeof generateJsonFn
  similarityThreshold?: number
  confidenceThreshold?: number
}

export interface ValidateBatchResult {
  total: number
  autoPassed: number
  needsReview: number
  /**
   * このバッチの全アイテム数（statusを問わない）。`total`（pending_validationとして
   * 実際に処理した件数）が0のとき、「このバッチ自体にアイテムが1件も無い」のか
   * 「既に検証済みでpending_validationが残っていないだけ」なのかをCLI側で
   * 区別できるようにするために追加（`validate_batch.ts`参照）。
   */
  totalItemsInBatch: number
}

interface BatchItemRow {
  id: string
  raw_payload: unknown
  status: string
}

/**
 * 10.9: DB全体との近似重複検出（8.4②）とは別に、同一バッチ内で生成された項目同士の
 * 重複を検出する。正規化(trim・小文字化)後のquestion_textが一致する場合、後発の項目を
 * 対象とする（先発は通常どおり構造チェック以降に進む）。メッセージには先発項目の
 * question_textを含め、どの項目と重複したかを名指しする（10.10のトレーサビリティ方針）。
 */
function findInBatchGrammarDuplicates(items: BatchItemRow[]): Map<string, string> {
  const seen = new Map<string, string>()
  const duplicates = new Map<string, string>()
  for (const item of items) {
    const raw = item.raw_payload as { question_text?: unknown }
    if (typeof raw?.question_text !== 'string') continue // 構造チェックで別途弾かれる
    const key = raw.question_text.trim().toLowerCase()
    const firstQuestionText = seen.get(key)
    if (firstQuestionText !== undefined) {
      duplicates.set(item.id, `同一バッチ内の他の項目（"${firstQuestionText}"）と質問文が重複しています`)
    } else {
      seen.set(key, raw.question_text)
    }
  }
  return duplicates
}

/** 10.9: 語彙版。既存のwordPosKey(word, part_of_speech)をそのまま流用する。 */
function findInBatchVocabDuplicates(items: BatchItemRow[]): Map<string, string> {
  const seen = new Map<string, string>()
  const duplicates = new Map<string, string>()
  for (const item of items) {
    const raw = item.raw_payload as { word?: unknown; part_of_speech?: unknown }
    if (typeof raw?.word !== 'string') continue // 構造チェックで別途弾かれる
    const key = wordPosKey(raw.word, typeof raw.part_of_speech === 'string' ? raw.part_of_speech : null)
    const firstWord = seen.get(key)
    if (firstWord !== undefined) {
      duplicates.set(item.id, `同一バッチ内の他の項目（"${firstWord}"）とword+part_of_speechが重複しています`)
    } else {
      seen.set(key, raw.word)
    }
  }
  return duplicates
}

/** 11.3: 追加解説版。同一バッチ内で同じtarget_idが複数回出力された場合（Gemini側の重複出力）を検出する。 */
function findInBatchAdditionalExplanationDuplicates(items: BatchItemRow[]): Map<string, string> {
  const seen = new Set<string>()
  const duplicates = new Map<string, string>()
  for (const item of items) {
    const raw = item.raw_payload as { target_id?: unknown }
    if (typeof raw?.target_id !== 'string') continue // 構造チェックで別途弾かれる
    if (seen.has(raw.target_id)) {
      duplicates.set(item.id, `同一バッチ内の他の項目とtarget_id（${raw.target_id}）が重複しています`)
    } else {
      seen.add(raw.target_id)
    }
  }
  return duplicates
}

async function markItem(
  supabase: SupabaseClient,
  itemId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('generation_batch_items').update(fields).eq('id', itemId)
  if (error) throw error
}

/** 21.5: `import_cefrj_wordlist.ts`の重複除外でも再利用するためexportしている。 */
export async function loadExistingVocabWordPosPairs(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from('vocab_words').select('word, part_of_speech')
  if (error) throw error
  return new Set(
    ((data ?? []) as { word: string; part_of_speech: string | null }[]).map((row) =>
      wordPosKey(row.word, row.part_of_speech),
    ),
  )
}

/**
 * 8.4: `generation_batch_items`のpending_validationアイテムを
 * ①構造チェック → ②近似重複検出 → ③一意性セルフチェック(文法のみ) の順に処理し、
 * `auto_passed` / `needs_review` へ振り分ける（8.1のフロー図のD〜F/Hに相当）。
 */
export async function validateBatch(batchId: string, deps: ValidateBatchDeps): Promise<ValidateBatchResult> {
  const { supabase, generateJson } = deps
  const similarityThreshold = deps.similarityThreshold ?? 0.6
  const confidenceThreshold = deps.confidenceThreshold ?? 0.8

  const { data: batchRow, error: batchError } = await supabase
    .from('generation_batches')
    .select('content_type')
    .eq('id', batchId)
    .single()
  if (batchError) throw batchError
  const contentType = (batchRow as { content_type: ContentType }).content_type

  const { data: allItemRows, error: itemsError } = await supabase
    .from('generation_batch_items')
    .select('id, raw_payload, status')
    .eq('batch_id', batchId)
  if (itemsError) throw itemsError

  const allItems = (allItemRows ?? []) as BatchItemRow[]
  const items = allItems.filter((item) => item.status === 'pending_validation')
  const totalItemsInBatch = allItems.length

  // 処理対象（pending_validation）が1件も無い場合は`generation_batches`を一切更新せずに
  // 早期returnする。ここで無条件にstatusを書き換えてしまうと、既に検証・コミット済みの
  // バッチに対してvalidate_batch.tsを再実行しただけで`status`が'completed'から
  // 'validating'に巻き戻るという実害のある不具合になる（何も処理していないのに状態を
  // 書き換えてしまうため）。`totalItemsInBatch`との比較はCLI側（validate_batch.ts）が
  // 「既に検証済みで0件」なのか「そもそもこのバッチにアイテムが無い」のかを
  // 区別するために使う。
  if (items.length === 0) {
    return { total: 0, autoPassed: 0, needsReview: 0, totalItemsInBatch }
  }

  const { error: statusError } = await supabase
    .from('generation_batches')
    .update({ status: 'validating' })
    .eq('id', batchId)
  if (statusError) throw statusError

  const existingVocabPairs = contentType === 'vocab' ? await loadExistingVocabWordPosPairs(supabase) : null

  // 10.9: バッチ内自己重複チェック。構造チェックより前に判定し、重複と判定された項目は
  // 以降のDB近似重複検出・セルフチェック（Gemini呼び出し）を無駄に行わないようスキップする。
  const inBatchDuplicates =
    contentType === 'grammar'
      ? findInBatchGrammarDuplicates(items)
      : contentType === 'vocab'
        ? findInBatchVocabDuplicates(items)
        : findInBatchAdditionalExplanationDuplicates(items)

  let autoPassed = 0
  let needsReview = 0

  for (const item of items) {
    try {
      const duplicateMessage = inBatchDuplicates.get(item.id)
      if (duplicateMessage) {
        await markItem(supabase, item.id, { status: 'needs_review', validation_errors: [duplicateMessage] })
        needsReview += 1
        continue
      }

      if (contentType === 'grammar') {
        const structural = validateGrammarItemStructure(item.raw_payload)
        if (!structural.valid) {
          await markItem(supabase, item.id, { status: 'needs_review', validation_errors: structural.errors })
          needsReview += 1
          continue
        }
        const parsed = structural.data!

        const similar = await findSimilarGrammarQuestions(supabase, parsed.question_text, similarityThreshold)
        if (similar.length > 0) {
          await markItem(supabase, item.id, {
            status: 'needs_review',
            validation_errors: [
              `類似度${similarityThreshold}以上の既存問題が見つかりました`,
              ...similar.map((s) => `- (${s.similarity.toFixed(2)}) ${s.question_text}`),
            ],
          })
          needsReview += 1
          continue
        }

        const selfCheck = await runGrammarSelfCheck(parsed, generateJson, confidenceThreshold)
        if (selfCheck.passed) {
          await markItem(supabase, item.id, { status: 'auto_passed', self_check_payload: selfCheck.payload })
          autoPassed += 1
        } else {
          await markItem(supabase, item.id, {
            status: 'needs_review',
            self_check_payload: selfCheck.payload,
            validation_errors: ['一意性セルフチェックで不一致または曖昧と判定されました'],
          })
          needsReview += 1
        }
      } else if (contentType === 'vocab') {
        const structural = validateVocabItemStructure(item.raw_payload, existingVocabPairs!)
        if (!structural.valid) {
          await markItem(supabase, item.id, { status: 'needs_review', validation_errors: structural.errors })
          needsReview += 1
          continue
        }
        const parsed = structural.data!

        const similar = await findSimilarVocabWords(supabase, parsed.word, similarityThreshold)
        if (similar.length > 0) {
          await markItem(supabase, item.id, {
            status: 'needs_review',
            validation_errors: [
              `類似度${similarityThreshold}以上の既存単語が見つかりました`,
              ...similar.map((s) => `- (${s.similarity.toFixed(2)}) ${s.word}`),
            ],
          })
          needsReview += 1
          continue
        }

        // 語彙は選択式問題ではないため一意性セルフチェックの対象外（8.4）
        await markItem(supabase, item.id, { status: 'auto_passed' })
        autoPassed += 1
      } else {
        // 11.3: grammar_explanation / vocab_explanation（間違いが多い問題への追加解説）。
        // 客観的に検証可能な判定軸が無いためセルフチェックは行わず、構造チェック＋対象行の
        // 実在確認・未設定確認のみで auto_passed とする（設計判断の理由は11.3参照）。
        const structural = validateAdditionalExplanationItemStructure(item.raw_payload)
        if (!structural.valid) {
          await markItem(supabase, item.id, { status: 'needs_review', validation_errors: structural.errors })
          needsReview += 1
          continue
        }
        const parsed = structural.data!
        const targetTable = contentType === 'grammar_explanation' ? 'grammar_questions' : 'vocab_words'

        const { data: targetRow, error: targetError } = await supabase
          .from(targetTable)
          .select('id, additional_explanation')
          .eq('id', parsed.target_id)
          .maybeSingle()
        if (targetError) throw targetError

        if (!targetRow) {
          await markItem(supabase, item.id, {
            status: 'needs_review',
            validation_errors: [`target_id "${parsed.target_id}" は${targetTable}に存在しません`],
          })
          needsReview += 1
          continue
        }
        if ((targetRow as { additional_explanation: string | null }).additional_explanation) {
          await markItem(supabase, item.id, {
            status: 'needs_review',
            validation_errors: [`target_id "${parsed.target_id}" には既に追加解説が設定済みです`],
          })
          needsReview += 1
          continue
        }

        await markItem(supabase, item.id, { status: 'auto_passed' })
        autoPassed += 1
      }
    } catch (error) {
      // 1アイテムの予期しない失敗（例: セルフチェックのレスポンスがJSON Schemaに従わず
      // Zodパースが例外を投げるケース）でバッチ全体・実行全体が止まらないようにする。
      // commitBatch.tsの「1件の失敗はneeds_reviewに差し戻し、バッチ全体は継続する」という
      // 既存方針とここで揃える（実データで、セルフチェックがsolved_indexの範囲外の値を
      // 返しZodErrorで検証全体がクラッシュした事例があったため追加した）。
      // エラーメッセージはError.messageを優先して抽出する。素の`String(error)`は
      // PostgrestErrorのようなプレーンオブジェクトに対して"[object Object]"になり、
      // 原因調査にSQLで実データを確認し直す必要が生じる（commitBatch.tsが20260812発見の
      // 実例を受けて既に採用しているパターンに揃える、10.10参照）。
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error)
      console.error(`item ${item.id} の検証中に予期しないエラーが発生しました:`, error)
      await markItem(supabase, item.id, {
        status: 'needs_review',
        validation_errors: [`検証中に予期しないエラーが発生しました: ${errorMessage}`],
      })
      needsReview += 1
    }
  }

  const { error: finalizeError } = await supabase
    .from('generation_batches')
    .update({
      needs_review_count: needsReview,
      status: needsReview > 0 ? 'needs_review' : 'validating',
    })
    .eq('id', batchId)
  if (finalizeError) throw finalizeError

  return { total: items.length, autoPassed, needsReview, totalItemsInBatch }
}
