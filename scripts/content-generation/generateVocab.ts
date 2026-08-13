import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildIdiomPrompt,
  buildVocabFromWordlistPrompt,
  buildVocabPrompt,
  VOCAB_JSON_SCHEMA,
  type WordlistCandidate,
} from './promptTemplates'
import type { generateJsonArray as generateJsonArrayFn } from './gemini'
import { loadEnv } from './env'

export type { WordlistCandidate }

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
  generateJsonArray: typeof generateJsonArrayFn
}

export interface GenerateVocabBatchResult {
  batchId: string
  itemCount: number
  /** 10.6: Gemini出力が最大トークン数で切り詰められた可能性がある場合true */
  truncated: boolean
}

const DB_WIDE_SAMPLES_LIMIT = 100
const SAME_TAG_SAMPLES_LIMIT = 50

/**
 * 重複回避コンテキスト用の既存単語のうち、タグを問わずDB全体から直近N件を取得する。
 *
 * 20260810発見の不具合修正: 従来（`getExistingWordsForTag`）はタグ単位でしか既存語を
 * 見ていなかったため、既に別タグでコミット済みの単語をGeminiが再提案し、無駄な
 * needs_reviewを発生させていた（ビジネス/日常会話/Part7頻出のバックフィルで`itinerary`等が
 * 繰り返し発生）。近似重複検出（8.4②のRPC、コミット時の最終防波堤）はDB全体を見ているため
 * 実際に重複登録される実害は無かったが、この生成プロンプトへの重複回避コンテキスト自体を
 * DB全体に広げることで、そもそもneeds_reviewに落ちる頻度を減らす。
 */
async function getDbWideExistingWords(supabase: SupabaseClient): Promise<string[]> {
  const { data: wordRows, error: wordError } = await supabase
    .from('vocab_words')
    .select('word')
    .order('created_at', { ascending: false })
    .limit(DB_WIDE_SAMPLES_LIMIT)
  if (wordError) throw wordError

  return ((wordRows ?? []) as { word: string }[]).map((r) => r.word)
}

/**
 * 重複回避コンテキスト用の既存単語のうち、対象タグに属する単語を直近N件取得する
 * （`vocab_word_tags`経由、`src/lib/queries/vocab.ts`の`getWordIdsForTag`と同じ2段階クエリ）。
 * タグがまだ1件も無い場合（新規タグ）は空配列を返す。
 *
 * 2026-08-12追加: DB全体を見るだけ（`getDbWideExistingWords`のみ、直近100件）では、
 * ローカルDB（159件、イディオムの一括バックフィルが直近を占有）で実際に検証バッチを
 * 生成したところ、ビジネスタグの一般的な単語（negotiate/implement/accommodate/
 * preliminary/obligation/facilitate/allocate、いずれもDB全体で古い方から数えて
 * 上位45件以内＝直近100件のサンプルにも入らない）が再生成され、needs_review
 * （構造チェックの完全一致重複）に落ちる事例を複数確認した（DESIGN.md 16章参照）。
 * これは「そのタグで最初に登録された基本的な単語」ほど、後から他タグへ大量投入される
 * ほど相対的に古くなり、直近N件という窓から外れてしまうという、DB全体を見る変更だけでは
 * 解決しない別種の問題だった。対象タグ自身の単語を別枠で必ず含めることで解消する
 * （DB全体を見る20260810の修正と両立させる、片方だけでは不十分）。
 */
async function getSameTagExistingWords(supabase: SupabaseClient, tagName: string): Promise<string[]> {
  const { data: tagRow, error: tagError } = await supabase
    .from('vocab_tags')
    .select('id')
    .eq('name', tagName)
    .maybeSingle()
  if (tagError) throw tagError
  if (!tagRow) return [] // 新規タグ（まだ1件も無い）

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
    .limit(SAME_TAG_SAMPLES_LIMIT)
  if (wordError) throw wordError

  return ((wordRows ?? []) as { word: string }[]).map((r) => r.word)
}

/**
 * 重複回避コンテキスト用の既存単語を、対象タグの単語（直近50件）とDB全体の単語（直近100件）の
 * 両方を合わせて重複排除し取得する。パフォーマンスについて: `vocab_words`全件を毎回取得する
 * わけではなく、いずれもLIMIT句で頭打ちにしている。現状の規模（数百件）ではこれで十分高速であり、
 * 追加のキャッシュ・専用インデックスは不要と判断した——将来数万件規模まで育った場合は
 * `vocab_words(created_at desc)`への索引追加（一行の後方互換マイグレーション）で対応できる設計。
 */
async function getExistingWords(supabase: SupabaseClient, tagName: string): Promise<string[]> {
  const [dbWideWords, sameTagWords] = await Promise.all([
    getDbWideExistingWords(supabase),
    getSameTagExistingWords(supabase, tagName),
  ])
  return Array.from(new Set([...sameTagWords, ...dbWideWords]))
}

/**
 * 8.1のA→B→C（生成トリガー→Gemini API→generation_batch_itemsへの保存）を実行する。
 * 8.4以降の検証はここでは行わない（validate_batch.tsの責務）。
 * 13.2: contentKind='idiom'のときはprompts/idiom.mdを使う（tagNameパラメータは無視する）。
 * 重複回避の既存サンプルは対象タグの単語＋タグを問わずDB全体の単語の両方を取得する
 * （`getExistingWords`参照）。
 */
export async function generateVocabBatch(
  params: GenerateVocabBatchParams,
  deps: GenerateVocabBatchDeps,
): Promise<GenerateVocabBatchResult> {
  const { supabase, generateJsonArray } = deps
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

  const existingWords = await getExistingWords(supabase, effectiveTagName)

  const prompt =
    contentKind === 'idiom'
      ? buildIdiomPrompt({ count: params.count, targetBand: params.targetBand, existingWords })
      : buildVocabPrompt({
          tagName: effectiveTagName,
          count: params.count,
          targetBand: params.targetBand,
          existingWords,
        })

  const { items, truncated, parseRecovered } = await generateJsonArray<unknown>({
    prompt,
    schema: VOCAB_JSON_SCHEMA,
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

export interface GenerateVocabBatchFromWordlistParams {
  /** 事前に選定・重複除外済みの単語リスト（CEFR-J等、21章参照）。空配列は不可。 */
  words: WordlistCandidate[]
  targetBand: number
  promptVersion?: string
  modelName?: string
}

/**
 * 21.5: `generateVocabBatch`（タグ名+件数→Geminiが単語選定から丸ごと生成）とは別に、
 * 単語選定を外部リストに委ねたフロー。`content_type`は既存と同じ'vocab'のまま
 * （DBスキーマ変更なし、21.3の想定どおり）。既存の`getDbWideExistingWords`をそのまま
 * 再利用し、重複回避コンテキストとしてDB全体の直近語をプロンプトに含める——単一タグに
 * 紐づかないため（Gemini自身がタグを選ぶ）、`getSameTagExistingWords`は使わない。
 * `generateVocabBatch`本体は無改修のまま、この関数だけを追加した。
 */
export async function generateVocabBatchFromWordlist(
  params: GenerateVocabBatchFromWordlistParams,
  deps: GenerateVocabBatchDeps,
): Promise<GenerateVocabBatchResult> {
  const { supabase, generateJsonArray } = deps

  if (params.words.length === 0) {
    throw new Error('words は1件以上必要です')
  }

  const modelName = params.modelName ?? loadEnv().GEMINI_MODEL
  const promptVersion = params.promptVersion ?? 'vocab_from_wordlist_v1'

  const { data: batch, error: batchError } = await supabase
    .from('generation_batches')
    .insert({
      content_type: 'vocab',
      model_name: modelName,
      prompt_version: promptVersion,
      requested_count: params.words.length,
      status: 'generating',
    })
    .select('id')
    .single()
  if (batchError) throw batchError
  const batchId = (batch as { id: string }).id

  const existingWords = await getDbWideExistingWords(supabase)

  const prompt = buildVocabFromWordlistPrompt({
    words: params.words,
    targetBand: params.targetBand,
    existingWords,
  })

  const { items, truncated, parseRecovered } = await generateJsonArray<unknown>({
    prompt,
    schema: VOCAB_JSON_SCHEMA,
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

  const notes =
    truncated || parseRecovered
      ? `Gemini出力が最大トークン数で切り詰められた可能性があります（依頼${params.words.length}件中${items.length}件のみ生成・保存）。`
      : null

  const { error: updateError } = await supabase
    .from('generation_batches')
    .update({ generated_count: items.length, status: 'validating', notes })
    .eq('id', batchId)
  if (updateError) throw updateError

  return { batchId, itemCount: items.length, truncated: truncated || parseRecovered }
}
