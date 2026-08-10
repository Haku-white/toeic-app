import type { SupabaseClient } from '@supabase/supabase-js'
import { buildIdiomPrompt, buildVocabPrompt, VOCAB_JSON_SCHEMA } from './promptTemplates'
import type { generateJson as generateJsonFn } from './gemini'
import { loadEnv } from './env'

/** 13.1: イディオムは常にこのタグに紐づく（`vocab_tags`への事前seedは不要、8.6のupsertで自動作成される） */
export const IDIOM_TAG_NAME = 'イディオム'

export interface GenerateVocabBatchParams {
  /** contentKind='idiom'のときは無視され、常にIDIOM_TAG_NAMEが使われる */
  tagName?: string
  count: number
  targetBand: number
  promptVersion?: string
  modelName?: string
  /** 13.2: 通常語彙かイディオムかを切り替える（既定'vocab'） */
  contentKind?: 'vocab' | 'idiom'
}

export interface GenerateVocabBatchDeps {
  supabase: SupabaseClient
  generateJson: typeof generateJsonFn
}

export interface GenerateVocabBatchResult {
  batchId: string
  itemCount: number
}

const EXISTING_SAMPLES_LIMIT = 30

/** 指定タグに紐づく既存単語（重複回避コンテキスト用）を直近N件取得する。タグが未作成なら空配列。 */
async function getExistingWordsForTag(supabase: SupabaseClient, tagName: string): Promise<string[]> {
  const { data: tagRow, error: tagError } = await supabase
    .from('vocab_tags')
    .select('id')
    .eq('name', tagName)
    .maybeSingle()
  if (tagError) throw tagError
  if (!tagRow) return []

  const { data: wordTagRows, error: wordTagError } = await supabase
    .from('vocab_word_tags')
    .select('vocab_word_id')
    .eq('tag_id', (tagRow as { id: number }).id)
  if (wordTagError) throw wordTagError

  const wordIds = ((wordTagRows ?? []) as { vocab_word_id: string }[]).map((r) => r.vocab_word_id)
  if (wordIds.length === 0) return []

  const { data: wordRows, error: wordError } = await supabase
    .from('vocab_words')
    .select('word')
    .in('id', wordIds)
    .order('created_at', { ascending: false })
    .limit(EXISTING_SAMPLES_LIMIT)
  if (wordError) throw wordError

  return ((wordRows ?? []) as { word: string }[]).map((r) => r.word)
}

/**
 * 8.1のA→B→C（生成トリガー→Gemini API→generation_batch_itemsへの保存）を実行する。
 * 8.4以降の検証はここでは行わない（validate_batch.tsの責務）。
 * 13.2: contentKind='idiom'のときはprompts/idiom.mdを使い、重複回避の既存サンプルも
 * IDIOM_TAG_NAMEに紐づく単語から取得する（tagNameパラメータは無視する）。
 */
export async function generateVocabBatch(
  params: GenerateVocabBatchParams,
  deps: GenerateVocabBatchDeps,
): Promise<GenerateVocabBatchResult> {
  const { supabase, generateJson } = deps
  const contentKind = params.contentKind ?? 'vocab'
  // CLIの--model指定 > .envのGEMINI_MODEL > env.tsのデフォルト、の優先順位で解決する
  // （以前は'gemini-2.5-flash'をここに直書きしており、.envのGEMINI_MODELが無視されていた）。
  const modelName = params.modelName ?? loadEnv().GEMINI_MODEL
  const promptVersion = params.promptVersion ?? (contentKind === 'idiom' ? 'idiom_v1' : 'vocab_v1')
  const effectiveTagName = contentKind === 'idiom' ? IDIOM_TAG_NAME : params.tagName

  if (!effectiveTagName) {
    throw new Error('tagName は必須です（contentKind="idiom" のときは不要）')
  }

  const { data: batch, error: batchError } = await supabase
    .from('generation_batches')
    .insert({
      content_type: 'vocab',
      model_name: modelName,
      prompt_version: promptVersion,
      requested_count: params.count,
      status: 'generating',
    })
    .select('id')
    .single()
  if (batchError) throw batchError
  const batchId = (batch as { id: string }).id

  const existingWords = await getExistingWordsForTag(supabase, effectiveTagName)

  const prompt =
    contentKind === 'idiom'
      ? buildIdiomPrompt({ count: params.count, targetBand: params.targetBand, existingWords })
      : buildVocabPrompt({
          tagName: effectiveTagName,
          count: params.count,
          targetBand: params.targetBand,
          existingWords,
        })

  const items = await generateJson<unknown[]>({ prompt, schema: VOCAB_JSON_SCHEMA, model: modelName })

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

  const { error: updateError } = await supabase
    .from('generation_batches')
    .update({ generated_count: items.length, status: 'validating' })
    .eq('id', batchId)
  if (updateError) throw updateError

  return { batchId, itemCount: items.length }
}
