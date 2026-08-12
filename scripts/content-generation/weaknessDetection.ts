import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_GRAMMAR_MIN_ATTEMPTS = 5
export const DEFAULT_GRAMMAR_MAX_ACCURACY = 0.7
export const DEFAULT_VOCAB_MIN_REVIEWS = 5
export const DEFAULT_VOCAB_MIN_AGAIN_RATE = 0.3

export interface WeakGrammarQuestion {
  id: string
  questionText: string
  choices: string[]
  correctIndex: number
  explanation: string | null
  accuracyRate: number
  attemptCount: number
}

export interface WeakVocabWord {
  id: string
  word: string
  meaningJa: string
  etymologyNote: string | null
  againRate: number
  reviewCount: number
}

/**
 * 11.1: `grammar_question_accuracy_stats`ビュー（11.2で追加）から正答率threshold未満・
 * 試行回数minAttempts以上の問題を抽出し、`grammar_questions`から本文を取得する。
 * 既に`additional_explanation`が設定済みの行は対象から除外する（再生成の重複防止）。
 */
export async function findWeakGrammarQuestions(
  supabase: SupabaseClient,
  minAttempts = DEFAULT_GRAMMAR_MIN_ATTEMPTS,
  maxAccuracy = DEFAULT_GRAMMAR_MAX_ACCURACY,
): Promise<WeakGrammarQuestion[]> {
  const { data: statsRows, error: statsError } = await supabase
    .from('grammar_question_accuracy_stats')
    .select('question_id, attempt_count, accuracy_rate')
    .gte('attempt_count', minAttempts)
    .lt('accuracy_rate', maxAccuracy)
  if (statsError) throw statsError

  const results: WeakGrammarQuestion[] = []
  for (const stat of (statsRows ?? []) as { question_id: string; attempt_count: number; accuracy_rate: number }[]) {
    const { data: question, error: questionError } = await supabase
      .from('grammar_questions')
      .select('id, question_text, choices, correct_index, explanation, additional_explanation')
      .eq('id', stat.question_id)
      .is('additional_explanation', null)
      .maybeSingle()
    if (questionError) throw questionError
    if (!question) continue // 既に追加解説済み、または該当行が見つからない

    const q = question as {
      id: string
      question_text: string
      choices: string[]
      correct_index: number
      explanation: string | null
    }
    results.push({
      id: q.id,
      questionText: q.question_text,
      choices: q.choices,
      correctIndex: q.correct_index,
      explanation: q.explanation,
      accuracyRate: stat.accuracy_rate,
      attemptCount: stat.attempt_count,
    })
  }
  return results
}

/**
 * 11.1: `vocab_word_again_stats`ビュー（11.2で追加）からagain率threshold以上・
 * レビュー回数minReviews以上の単語を抽出し、`vocab_words`から本文を取得する。
 * 既に`additional_explanation`が設定済みの行は対象から除外する。
 */
export async function findWeakVocabWords(
  supabase: SupabaseClient,
  minReviews = DEFAULT_VOCAB_MIN_REVIEWS,
  minAgainRate = DEFAULT_VOCAB_MIN_AGAIN_RATE,
): Promise<WeakVocabWord[]> {
  const { data: statsRows, error: statsError } = await supabase
    .from('vocab_word_again_stats')
    .select('vocab_word_id, review_count, again_rate')
    .gte('review_count', minReviews)
    .gte('again_rate', minAgainRate)
  if (statsError) throw statsError

  const results: WeakVocabWord[] = []
  for (const stat of (statsRows ?? []) as { vocab_word_id: string; review_count: number; again_rate: number }[]) {
    const { data: word, error: wordError } = await supabase
      .from('vocab_words')
      .select('id, word, meaning_ja, etymology_note, additional_explanation')
      .eq('id', stat.vocab_word_id)
      .is('additional_explanation', null)
      .maybeSingle()
    if (wordError) throw wordError
    if (!word) continue

    const w = word as { id: string; word: string; meaning_ja: string; etymology_note: string | null }
    results.push({
      id: w.id,
      word: w.word,
      meaningJa: w.meaning_ja,
      etymologyNote: w.etymology_note,
      againRate: stat.again_rate,
      reviewCount: stat.review_count,
    })
  }
  return results
}
