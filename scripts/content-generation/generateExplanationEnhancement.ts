import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ADDITIONAL_EXPLANATION_JSON_SCHEMA,
  buildGrammarAdditionalExplanationPrompt,
  buildVocabAdditionalExplanationPrompt,
} from './promptTemplates'
import type { generateJsonArray as generateJsonArrayFn } from './gemini'
import type { WeakGrammarQuestion, WeakVocabWord } from './weaknessDetection'
import { loadEnv } from './env'

export interface GenerateExplanationsDeps {
  supabase: SupabaseClient
  generateJsonArray: typeof generateJsonArrayFn
}

export interface GenerateExplanationsResult {
  batchId: string
  itemCount: number
  /** 10.6と同じ意味: Gemini出力が最大トークン数で切り詰められた可能性がある場合true */
  truncated: boolean
}

interface GenerateExplanationsParams<T> {
  items: T[]
  promptVersion?: string
  modelName?: string
}

async function insertExplanationBatch(
  deps: GenerateExplanationsDeps,
  contentType: 'grammar_explanation' | 'vocab_explanation',
  modelName: string,
  promptVersion: string,
  requestedCount: number,
  prompt: string,
): Promise<GenerateExplanationsResult> {
  const { data: batch, error: batchError } = await deps.supabase
    .from('generation_batches')
    .insert({
      content_type: contentType,
      model_name: modelName,
      prompt_version: promptVersion,
      requested_count: requestedCount,
      status: 'generating',
    })
    .select('id')
    .single()
  if (batchError) throw batchError
  const batchId = (batch as { id: string }).id

  const { items, truncated, parseRecovered } = await deps.generateJsonArray<unknown>({
    prompt,
    schema: ADDITIONAL_EXPLANATION_JSON_SCHEMA,
    model: modelName,
  })

  if (items.length > 0) {
    const { error: itemsError } = await deps.supabase.from('generation_batch_items').insert(
      items.map((raw_payload) => ({
        batch_id: batchId,
        raw_payload,
        status: 'pending_validation',
      })),
    )
    if (itemsError) throw itemsError
  }

  const notes =
    truncated || parseRecovered
      ? `Gemini出力が最大トークン数で切り詰められた可能性があります（依頼${requestedCount}件中${items.length}件のみ生成・保存）。`
      : null

  const { error: updateError } = await deps.supabase
    .from('generation_batches')
    .update({ generated_count: items.length, status: 'validating', notes })
    .eq('id', batchId)
  if (updateError) throw updateError

  return { batchId, itemCount: items.length, truncated: truncated || parseRecovered }
}

/**
 * 11.3: 正答率の低い文法問題（`items`、`weaknessDetection.ts`で抽出済み）について、
 * 追加解説（`additional_explanation`）をバッチ生成し`generation_batch_items`に保存する。
 * 新規問題を作る`generateGrammarBatch`とは異なり、既存の行を対象にした「補足生成」タスクのため
 * `content_type='grammar_explanation'`を使う（11.2でcontent_type enumに追加済み）。
 * セルフチェックは行わない（11.3参照: 客観的に検証可能な判定軸が無いため構造チェックのみに留める）。
 */
export async function generateGrammarExplanations(
  params: GenerateExplanationsParams<WeakGrammarQuestion>,
  deps: GenerateExplanationsDeps,
): Promise<GenerateExplanationsResult> {
  const modelName = params.modelName ?? loadEnv().GEMINI_MODEL
  const promptVersion = params.promptVersion ?? 'grammar_additional_explanation_v1'

  const prompt = buildGrammarAdditionalExplanationPrompt({
    items: params.items.map((item) => ({
      targetId: item.id,
      question_text: item.questionText,
      choices: item.choices,
      correct_answer: item.choices[item.correctIndex],
      existing_explanation: item.explanation ?? '(なし)',
      accuracy_rate: item.accuracyRate,
      attempt_count: item.attemptCount,
    })),
  })

  return insertExplanationBatch(deps, 'grammar_explanation', modelName, promptVersion, params.items.length, prompt)
}

/** 11.3: 語彙版。`content_type='vocab_explanation'`を使う。セルフチェックは行わない（同上）。 */
export async function generateVocabExplanations(
  params: GenerateExplanationsParams<WeakVocabWord>,
  deps: GenerateExplanationsDeps,
): Promise<GenerateExplanationsResult> {
  const modelName = params.modelName ?? loadEnv().GEMINI_MODEL
  const promptVersion = params.promptVersion ?? 'vocab_additional_explanation_v1'

  const prompt = buildVocabAdditionalExplanationPrompt({
    items: params.items.map((item) => ({
      targetId: item.id,
      word: item.word,
      meaning_ja: item.meaningJa,
      existing_etymology_note: item.etymologyNote ?? '(なし)',
      again_rate: item.againRate,
      review_count: item.reviewCount,
    })),
  })

  return insertExplanationBatch(deps, 'vocab_explanation', modelName, promptVersion, params.items.length, prompt)
}
