import { supabase } from '../supabase'
import type { FsrsRatingKey, VocabProgressState } from '../fsrs'
import { getRandomGrammarQuestions, type GrammarQuestion } from './grammar'
import { progressRowToState, type UserVocabProgressRow, type VocabWordRow } from './vocab'

export interface MixedQuestion {
  id: string
  kind: 'grammar' | 'vocab'
  questionText: string
  choices: string[]
  correctIndex: number
  /** grammarは既存explanation、vocabはetymology_noteを流用（14.2） */
  explanation: string | null
  /** kind='grammar'のとき submitGrammarAttempt 用 */
  grammarQuestionId?: string
  /** kind='vocab'のとき submitVocabReview 用 */
  vocabWordId?: string
  /** kind='vocab'のとき submitVocabReview の currentProgress として使う */
  vocabProgress?: VocabProgressState | null
}

export type ShuffleFn = <T>(items: T[]) => T[]

export function defaultShuffle<T>(items: T[]): T[] {
  const array = [...items]
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

const DISTRACTOR_COUNT = 3
const VOCAB_SAMPLE_POOL_SIZE = 50

function grammarQuestionToMixed(q: GrammarQuestion): MixedQuestion {
  return {
    id: `grammar-${q.id}`,
    kind: 'grammar',
    questionText: q.questionText,
    choices: q.choices,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    grammarQuestionId: q.id,
  }
}

/**
 * 14.2: `vocab_words`の1件を「意味を問う4択」に変換する（SRSのreveal形式とは別の出題パターン）。
 * 副作用のない純粋関数として実装し、`shuffle`を注入可能にしてテストしやすくしている。
 */
export function buildVocabQuizQuestion(
  target: VocabWordRow,
  pool: VocabWordRow[],
  vocabProgress: VocabProgressState | null,
  shuffle: ShuffleFn = defaultShuffle,
): MixedQuestion {
  const shuffledPool = shuffle(pool)
  const seenMeanings = new Set([target.meaning_ja])
  const distractors: string[] = []

  for (const candidate of shuffledPool) {
    if (distractors.length >= DISTRACTOR_COUNT) break
    if (candidate.id === target.id) continue
    if (seenMeanings.has(candidate.meaning_ja)) continue
    seenMeanings.add(candidate.meaning_ja)
    distractors.push(candidate.meaning_ja)
  }

  const choices = shuffle([target.meaning_ja, ...distractors])
  const correctIndex = choices.indexOf(target.meaning_ja)

  return {
    id: `vocab-${target.id}`,
    kind: 'vocab',
    questionText: `「${target.word}」の意味として最も適切なものを選んでください。`,
    choices,
    correctIndex,
    explanation: target.etymology_note,
    vocabWordId: target.id,
    vocabProgress,
  }
}

async function fetchRandomVocabQuestions(
  userId: string,
  count: number,
  shuffle: ShuffleFn,
): Promise<MixedQuestion[]> {
  const { data, error } = await supabase.from('vocab_words').select('*').limit(VOCAB_SAMPLE_POOL_SIZE)
  if (error) throw error

  const words = data as VocabWordRow[]
  if (words.length === 0) return []

  const targets = shuffle(words).slice(0, count)
  const targetIds = targets.map((w) => w.id)

  const { data: progressRows, error: progressError } = await supabase
    .from('user_vocab_progress')
    .select('*')
    .eq('user_id', userId)
    .in('vocab_word_id', targetIds)
  if (progressError) throw progressError

  const progressByWordId = new Map<string, VocabProgressState>(
    (progressRows as UserVocabProgressRow[]).map((row) => [row.vocab_word_id, progressRowToState(row)]),
  )

  return targets.map((target) =>
    buildVocabQuizQuestion(target, words, progressByWordId.get(target.id) ?? null, shuffle),
  )
}

/**
 * 14.2: 文法・語彙の混合問題セットを取得する。ランダムに抽出した文法問題と語彙4択問題を
 * まとめてシャッフルし、ランダムな順番で出題する（交互だと単調・予測可能になるため）。
 */
export async function getMixedDrillQuestions(
  userId: string,
  grammarCount = 5,
  vocabCount = 5,
  shuffle: ShuffleFn = defaultShuffle,
): Promise<MixedQuestion[]> {
  const grammarQuestions = await getRandomGrammarQuestions(grammarCount)
  const vocabQuestions = await fetchRandomVocabQuestions(userId, vocabCount, shuffle)

  return shuffle([...grammarQuestions.map(grammarQuestionToMixed), ...vocabQuestions])
}

/**
 * 14.4: 4択（再認）は単語カードでの再生（/vocab/review）より記憶の証拠として弱いため、
 * 正解でも`good`ではなく1段階低い`hard`として記録する。不正解は`again`。
 */
export function mapMixedDrillAnswerToRating(isCorrect: boolean): FsrsRatingKey {
  return isCorrect ? 'hard' : 'again'
}
