import { supabase } from '../supabase'
import { computeNextState, type FsrsRatingKey, type FsrsStateKey, type VocabProgressState } from '../fsrs'

export interface VocabCard {
  vocabWordId: string
  word: string
  partOfSpeech: string | null
  meaningJa: string
  exampleSentenceEn: string
  exampleSentenceJa: string | null
  /** 接頭辞・語幹・接尾辞の分解と意味のヒント。バッチ生成データ・モックデータともに任意項目のためnull許容 */
  etymologyNote: string | null
  /** null = このユーザーにとって初出の単語（`user_vocab_progress`行がまだ無い） */
  progress: VocabProgressState | null
}

/** 14章の総合問題（mixedDrill.ts）でも同じ行の形を再利用するためexportしている */
export interface VocabWordRow {
  id: string
  word: string
  part_of_speech: string | null
  meaning_ja: string
  example_sentence_en: string
  example_sentence_ja: string | null
  etymology_note: string | null
}

/** 14章の総合問題（mixedDrill.ts）でも同じ行マッピングを再利用するためexportしている */
export interface UserVocabProgressRow {
  vocab_word_id: string
  state: FsrsStateKey
  due_at: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  last_review_at: string | null
}

export function progressRowToState(row: UserVocabProgressRow): VocabProgressState {
  return {
    state: row.state,
    dueAt: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    lastReviewAt: row.last_review_at,
  }
}

function wordRowToCard(word: VocabWordRow, progress: VocabProgressState | null): VocabCard {
  return {
    vocabWordId: word.id,
    word: word.word,
    partOfSpeech: word.part_of_speech,
    meaningJa: word.meaning_ja,
    exampleSentenceEn: word.example_sentence_en,
    exampleSentenceJa: word.example_sentence_ja,
    etymologyNote: word.etymology_note,
    progress,
  }
}

export interface VocabTag {
  id: number
  name: string
}

/**
 * `code`（= `vocab_tags.code`、URL用英語スラッグ、16章）から`vocab_tags`の1件を取得する。無ければnull。
 * `/vocab/review/:tagCode`の表示名解決（`VocabReview.tsx`）と`getWordIdsForTag`の両方から再利用する。
 */
export async function getVocabTagByCode(tagCode: string): Promise<VocabTag | null> {
  const { data, error } = await supabase.from('vocab_tags').select('id, name').eq('code', tagCode).maybeSingle()
  if (error) throw error
  return data as VocabTag | null
}

export interface VocabTagSummary {
  id: number
  code: string
  name: string
}

/**
 * 18.2: `/vocab/tags`用に全`vocab_tags`を一覧取得する（解答履歴の有無に関わらず表示するため、
 * `user_vocab_tag_stats`ではなく`vocab_tags`を直接参照する）。`code`が未割り当てのタグ
 * （16.2: 移行期でnullable）は`/vocab/review/:tagCode`のURLを組み立てられないため除外する。
 */
export async function getVocabTags(): Promise<VocabTagSummary[]> {
  const { data, error } = await supabase
    .from('vocab_tags')
    .select('id, code, name')
    .not('code', 'is', null)
    .order('name', { ascending: true })
  if (error) throw error
  return data as VocabTagSummary[]
}

/** `tagCode`に属する`vocab_word_id`一覧を取得する。該当タグが無ければ空配列。 */
async function getWordIdsForTag(tagCode: string): Promise<string[]> {
  const tag = await getVocabTagByCode(tagCode)
  if (!tag) return []

  const { data: wordTagRows, error: wordTagError } = await supabase
    .from('vocab_word_tags')
    .select('vocab_word_id')
    .eq('tag_id', tag.id)
  if (wordTagError) throw wordTagError

  return (wordTagRows as { vocab_word_id: string }[]).map((row) => row.vocab_word_id)
}

/**
 * 本日レビューすべき語彙カードを取得する（9.4の方針: コンポーネントから直接supabase.from()を呼ばない）。
 * 優先順位: ① due_atが到来済みの復習カード → ② まだ着手していない新規カードで残り枠を埋める
 * `tagCode`を指定すると、そのタグに属する単語のみを対象にする（`/vocab/review/:tagCode`用、9.3参照）。
 */
export async function getDueVocabCards(userId: string, limit = 20, tagCode?: string): Promise<VocabCard[]> {
  const nowIso = new Date().toISOString()

  const tagWordIds = tagCode ? await getWordIdsForTag(tagCode) : null
  if (tagWordIds && tagWordIds.length === 0) return []

  let dueProgressQuery = supabase
    .from('user_vocab_progress')
    .select('*')
    .eq('user_id', userId)
    .lte('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(limit)
  if (tagWordIds) {
    dueProgressQuery = dueProgressQuery.in('vocab_word_id', tagWordIds)
  }
  const { data: dueProgressRows, error: dueProgressError } = await dueProgressQuery
  if (dueProgressError) throw dueProgressError

  const dueProgressByWordId = new Map<string, VocabProgressState>(
    (dueProgressRows as UserVocabProgressRow[]).map((row) => [row.vocab_word_id, progressRowToState(row)]),
  )

  const cards: VocabCard[] = []

  if (dueProgressByWordId.size > 0) {
    const { data: dueWords, error: dueWordsError } = await supabase
      .from('vocab_words')
      .select('*')
      .in('id', Array.from(dueProgressByWordId.keys()))
    if (dueWordsError) throw dueWordsError

    for (const word of dueWords as VocabWordRow[]) {
      cards.push(wordRowToCard(word, dueProgressByWordId.get(word.id) ?? null))
    }
  }

  const remaining = limit - cards.length
  if (remaining > 0) {
    const { data: allProgressRows, error: allProgressError } = await supabase
      .from('user_vocab_progress')
      .select('vocab_word_id')
      .eq('user_id', userId)
    if (allProgressError) throw allProgressError

    const seenWordIds = (allProgressRows as Pick<UserVocabProgressRow, 'vocab_word_id'>[]).map(
      (row) => row.vocab_word_id,
    )

    let newWordsQuery = supabase
      .from('vocab_words')
      .select('*')
      .order('frequency_rank', { ascending: true, nullsFirst: false })
      .limit(remaining)
    if (tagWordIds) {
      newWordsQuery = newWordsQuery.in('id', tagWordIds)
    }
    if (seenWordIds.length > 0) {
      newWordsQuery = newWordsQuery.not('id', 'in', `(${seenWordIds.join(',')})`)
    }

    const { data: newWords, error: newWordsError } = await newWordsQuery
    if (newWordsError) throw newWordsError

    for (const word of newWords as VocabWordRow[]) {
      cards.push(wordRowToCard(word, null))
    }
  }

  return cards
}

export interface SubmitVocabReviewParams {
  userId: string
  vocabWordId: string
  currentProgress: VocabProgressState | null
  rating: FsrsRatingKey
  responseTimeMs?: number
}

/**
 * FSRSで次回状態を計算し、`user_vocab_progress`をUPSERT・`vocab_review_logs`にINSERTする。
 * クライアントから直接書き込むのはこの2テーブルのみ（7章のRLS方針どおり）。
 */
export async function submitVocabReview(params: SubmitVocabReviewParams): Promise<VocabProgressState> {
  const { userId, vocabWordId, currentProgress, rating, responseTimeMs } = params
  const now = new Date()
  const { progress, reviewLog } = computeNextState(currentProgress, rating, now)

  const { error: upsertError } = await supabase.from('user_vocab_progress').upsert(
    {
      user_id: userId,
      vocab_word_id: vocabWordId,
      state: progress.state,
      due_at: progress.dueAt,
      stability: progress.stability,
      difficulty: progress.difficulty,
      elapsed_days: progress.elapsedDays,
      scheduled_days: progress.scheduledDays,
      reps: progress.reps,
      lapses: progress.lapses,
      last_review_at: progress.lastReviewAt,
    },
    { onConflict: 'user_id,vocab_word_id' },
  )
  if (upsertError) throw upsertError

  const { error: logError } = await supabase.from('vocab_review_logs').insert({
    user_id: userId,
    vocab_word_id: vocabWordId,
    rating: reviewLog.rating,
    state: reviewLog.state,
    due_at: reviewLog.dueAt,
    stability: reviewLog.stability,
    difficulty: reviewLog.difficulty,
    elapsed_days: reviewLog.elapsedDays,
    last_elapsed_days: reviewLog.lastElapsedDays,
    scheduled_days: reviewLog.scheduledDays,
    response_time_ms: responseTimeMs ?? null,
  })
  if (logError) throw logError

  return progress
}
