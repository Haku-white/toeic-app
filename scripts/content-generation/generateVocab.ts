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

/**
 * 重複回避コンテキスト用の既存単語を直近N件、タグを問わずDB全体から取得する。
 *
 * 20260810発見の不具合修正: 従来（`getExistingWordsForTag`）はタグ単位でしか既存語を
 * 見ていなかったため、既に別タグでコミット済みの単語をGeminiが再提案し、無駄な
 * needs_reviewを発生させていた（ビジネス/日常会話/Part7頻出のバックフィルで`itinerary`等が
 * 繰り返し発生）。近似重複検出（8.4②のRPC、コミット時の最終防波堤）はDB全体を見ているため
 * 実際に重複登録される実害は無かったが、この生成プロンプトへの重複回避コンテキスト自体を
 * DB全体に広げることで、そもそもneeds_reviewに落ちる頻度を減らす。
 */
async function getExistingWords(supabase: SupabaseClient): Promise<string[]> {
  const { data: wordRows, error: wordError } = await supabase
    .from('vocab_words')
    .select('word')
    .order('created_at', { ascending: false })
    .limit(EXISTING_SAMPLES_LIMIT)
  if (wordError) throw wordError

  return ((wordRows ?? []) as { word: string }[]).map((r) => r.word)
}

/**
 * 8.1のA→B→C（生成トリガー→Gemini API→generation_batch_itemsへの保存）を実行する。
 * 8.4以降の検証はここでは行わない（validate_batch.tsの責務）。
 * 13.2: contentKind='idiom'のときはprompts/idiom.mdを使う（tagNameパラメータは無視する）。
 * 重複回避の既存サンプルはタグを問わずDB全体から取得する（`getExistingWords`参照）。
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

  const existingWords = await getExistingWords(supabase)

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
