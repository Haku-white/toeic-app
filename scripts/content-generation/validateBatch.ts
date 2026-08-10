import type { SupabaseClient } from '@supabase/supabase-js'
import { findSimilarGrammarQuestions, findSimilarVocabWords } from './duplicateCheck'
import { runGrammarSelfCheck } from './selfCheck'
import { validateGrammarItemStructure, validateVocabItemStructure, wordPosKey } from './structuralValidation'
import type { generateJson as generateJsonFn } from './gemini'

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

async function markItem(
  supabase: SupabaseClient,
  itemId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('generation_batch_items').update(fields).eq('id', itemId)
  if (error) throw error
}

async function loadExistingVocabWordPosPairs(supabase: SupabaseClient): Promise<Set<string>> {
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
  const contentType = (batchRow as { content_type: 'grammar' | 'vocab' }).content_type

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

  let autoPassed = 0
  let needsReview = 0

  for (const item of items) {
    try {
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
      } else {
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
      }
    } catch (error) {
      // 1アイテムの予期しない失敗（例: セルフチェックのレスポンスがJSON Schemaに従わず
      // Zodパースが例外を投げるケース）でバッチ全体・実行全体が止まらないようにする。
      // commitBatch.tsの「1件の失敗はneeds_reviewに差し戻し、バッチ全体は継続する」という
      // 既存方針とここで揃える（実データで、セルフチェックがsolved_indexの範囲外の値を
      // 返しZodErrorで検証全体がクラッシュした事例があったため追加した）。
      console.error(`item ${item.id} の検証中に予期しないエラーが発生しました:`, error)
      await markItem(supabase, item.id, {
        status: 'needs_review',
        validation_errors: [`検証中に予期しないエラーが発生しました: ${String(error)}`],
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
