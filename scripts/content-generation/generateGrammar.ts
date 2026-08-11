import type { SupabaseClient } from '@supabase/supabase-js'
import { buildGrammarPrompt, GRAMMAR_JSON_SCHEMA } from './promptTemplates'
import type { generateJsonArray as generateJsonArrayFn } from './gemini'
import { loadEnv } from './env'

export interface GenerateGrammarBatchParams {
  categoryCode: string
  count: number
  difficulty: number
  targetBand: number
  promptVersion?: string
  modelName?: string
}

export interface GenerateGrammarBatchDeps {
  supabase: SupabaseClient
  generateJsonArray: typeof generateJsonArrayFn
}

export interface GenerateGrammarBatchResult {
  batchId: string
  itemCount: number
  /** 10.6: Gemini出力が最大トークン数で切り詰められた可能性がある場合true */
  truncated: boolean
}

const EXISTING_SAMPLES_LIMIT = 30

/**
 * 8.1のA→B→C（生成トリガー→Gemini API→generation_batch_itemsへの保存）を実行する。
 * 8.4以降の検証はここでは行わない（validate_batch.tsの責務）。
 */
export async function generateGrammarBatch(
  params: GenerateGrammarBatchParams,
  deps: GenerateGrammarBatchDeps,
): Promise<GenerateGrammarBatchResult> {
  const { supabase, generateJsonArray } = deps
  // CLIの--model指定 > .envのGEMINI_MODEL > env.tsのデフォルト、の優先順位で解決する
  // （以前は'gemini-2.5-flash'をここに直書きしており、.envのGEMINI_MODELが無視されていた）。
  const modelName = params.modelName ?? loadEnv().GEMINI_MODEL
  const promptVersion = params.promptVersion ?? 'grammar_v1'

  const { data: category, error: categoryError } = await supabase
    .from('grammar_categories')
    .select('id, name_ja')
    .eq('code', params.categoryCode)
    .single()
  if (categoryError) throw categoryError

  const { data: batch, error: batchError } = await supabase
    .from('generation_batches')
    .insert({
      content_type: 'grammar',
      model_name: modelName,
      prompt_version: promptVersion,
      requested_count: params.count,
      status: 'generating',
    })
    .select('id')
    .single()
  if (batchError) throw batchError
  const batchId = (batch as { id: string }).id

  const { data: existingRows, error: existingError } = await supabase
    .from('grammar_questions')
    .select('question_text')
    .eq('category_id', (category as { id: number }).id)
    .order('created_at', { ascending: false })
    .limit(EXISTING_SAMPLES_LIMIT)
  if (existingError) throw existingError

  const prompt = buildGrammarPrompt({
    categoryCode: params.categoryCode,
    categoryNameJa: (category as { name_ja: string }).name_ja,
    count: params.count,
    difficulty: params.difficulty,
    targetBand: params.targetBand,
    existingQuestionSamples: ((existingRows ?? []) as { question_text: string }[]).map((r) => r.question_text),
  })

  const { items, truncated, parseRecovered } = await generateJsonArray<unknown>({
    prompt,
    schema: GRAMMAR_JSON_SCHEMA,
    model: modelName,
  })

  if (items.length > 0) {
    const { error: itemsError } = await supabase.from('generation_batch_items').insert(
      items.map((raw_payload) => ({
        batch_id: batchId,
        raw_payload,
        status: 'pending_validation',
      })),
    )
    if (itemsError) throw itemsError
  }

  // 10.6: 切り詰め・パース救済が起きた場合はnotesに残す（原因追跡用、20260812の教訓と同じ思想）。
  const notes =
    truncated || parseRecovered
      ? `Gemini出力が最大トークン数で切り詰められた可能性があります（依頼${params.count}件中${items.length}件のみ生成・保存）。`
      : null

  const { error: updateError } = await supabase
    .from('generation_batches')
    .update({ generated_count: items.length, status: 'validating', notes })
    .eq('id', batchId)
  if (updateError) throw updateError

  return { batchId, itemCount: items.length, truncated: truncated || parseRecovered }
}
