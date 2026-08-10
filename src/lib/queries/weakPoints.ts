import { supabase } from '../supabase'

export interface GrammarCategoryStat {
  categoryId: number
  categoryCode: string
  categoryName: string
  totalAttempts: number
  correctAttempts: number
  accuracyRate: number
  lastAttemptedAt: string | null
}

export interface VocabTagStat {
  tagId: number
  tagCode: string
  tagName: string
  totalReviews: number
  correctReviews: number
  accuracyRate: number
  lastReviewedAt: string | null
}

interface GrammarCategoryStatRow {
  category_id: number
  category_code: string
  category_name: string
  total_attempts: number
  correct_attempts: number
  accuracy_rate: number
  last_attempted_at: string | null
}

interface VocabTagStatRow {
  tag_id: number
  tag_code: string
  tag_name: string
  total_reviews: number
  correct_reviews: number
  accuracy_rate: number
  last_reviewed_at: string | null
}

/** `user_grammar_category_stats`ビュー（5章・6.5）から文法カテゴリ別正答率を取得する */
export async function getGrammarCategoryStats(userId: string): Promise<GrammarCategoryStat[]> {
  const { data, error } = await supabase
    .from('user_grammar_category_stats')
    .select('*')
    .eq('user_id', userId)
    .order('accuracy_rate', { ascending: true })
  if (error) throw error

  return (data as GrammarCategoryStatRow[]).map((row) => ({
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    totalAttempts: row.total_attempts,
    correctAttempts: row.correct_attempts,
    accuracyRate: row.accuracy_rate,
    lastAttemptedAt: row.last_attempted_at,
  }))
}

/** `user_vocab_tag_stats`ビュー（5章・6.5）から語彙タグ別正答率を取得する */
export async function getVocabTagStats(userId: string): Promise<VocabTagStat[]> {
  const { data, error } = await supabase
    .from('user_vocab_tag_stats')
    .select('*')
    .eq('user_id', userId)
    .order('accuracy_rate', { ascending: true })
  if (error) throw error

  return (data as VocabTagStatRow[]).map((row) => ({
    tagId: row.tag_id,
    tagCode: row.tag_code,
    tagName: row.tag_name,
    totalReviews: row.total_reviews,
    correctReviews: row.correct_reviews,
    accuracyRate: row.accuracy_rate,
    lastReviewedAt: row.last_reviewed_at,
  }))
}
