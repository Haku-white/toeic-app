import type { SupabaseClient } from '@supabase/supabase-js'

export interface SimilarGrammarQuestion {
  id: string
  question_text: string
  similarity: number
}

export interface SimilarVocabWord {
  id: string
  word: string
  similarity: number
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.6
const DEFAULT_MATCH_LIMIT = 5

/** 8.4② `find_similar_grammar_questions` RPC（20260809050638）を呼び出す */
export async function findSimilarGrammarQuestions(
  supabase: SupabaseClient,
  questionText: string,
  similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  matchLimit = DEFAULT_MATCH_LIMIT,
): Promise<SimilarGrammarQuestion[]> {
  const { data, error } = await supabase.rpc('find_similar_grammar_questions', {
    query_text: questionText,
    similarity_threshold: similarityThreshold,
    match_limit: matchLimit,
  })
  if (error) throw error
  return (data ?? []) as SimilarGrammarQuestion[]
}

/** 8.4② `find_similar_vocab_words` RPC（20260809050638）を呼び出す */
export async function findSimilarVocabWords(
  supabase: SupabaseClient,
  word: string,
  similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  matchLimit = DEFAULT_MATCH_LIMIT,
): Promise<SimilarVocabWord[]> {
  const { data, error } = await supabase.rpc('find_similar_vocab_words', {
    query_word: word,
    similarity_threshold: similarityThreshold,
    match_limit: matchLimit,
  })
  if (error) throw error
  return (data ?? []) as SimilarVocabWord[]
}
