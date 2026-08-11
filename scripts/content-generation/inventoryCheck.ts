import type { SupabaseClient } from '@supabase/supabase-js'
import { VOCAB_TAG_CODES } from './vocabTagCodes'

export const DEFAULT_GRAMMAR_THRESHOLD = 30
export const DEFAULT_GRAMMAR_TARGET = 40
export const DEFAULT_VOCAB_THRESHOLD = 30
export const DEFAULT_VOCAB_TARGET = 40

export interface GrammarCategoryInventory {
  categoryId: number
  categoryCode: string
  nameJa: string
  count: number
  shortfall: number
}

export interface VocabTagInventory {
  tagId: number
  tagName: string
  count: number
  shortfall: number
}

/**
 * 10.2/10.3: 文法カテゴリ（9分類、4章）ごとの`grammar_questions`件数を集計し、
 * `threshold`未満のカテゴリのみを返す（副作用なし・読み取りのみ）。
 * `shortfall`は目標件数`target`まで埋めるのに必要な件数。
 */
export async function checkGrammarInventory(
  supabase: SupabaseClient,
  threshold = DEFAULT_GRAMMAR_THRESHOLD,
  target = DEFAULT_GRAMMAR_TARGET,
): Promise<GrammarCategoryInventory[]> {
  const { data: categories, error: categoriesError } = await supabase
    .from('grammar_categories')
    .select('id, code, name_ja')
  if (categoriesError) throw categoriesError

  const results: GrammarCategoryInventory[] = []
  for (const category of (categories ?? []) as { id: number; code: string; name_ja: string }[]) {
    const { count, error: countError } = await supabase
      .from('grammar_questions')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', category.id)
    if (countError) throw countError

    const actualCount = count ?? 0
    if (actualCount < threshold) {
      results.push({
        categoryId: category.id,
        categoryCode: category.code,
        nameJa: category.name_ja,
        count: actualCount,
        shortfall: Math.max(0, target - actualCount),
      })
    }
  }
  return results
}

/**
 * 10.2/10.3: 語彙タグ（イディオムを含む、`vocab_tags`）ごとの`vocab_word_tags`件数を集計し、
 * `threshold`未満のタグのみを返す。`code`が未設定、または`vocabTagCodes.ts`の
 * `VOCAB_TAG_CODES`に無い名前のタグは対象外としてスキップする——`commitBatch.ts`の
 * `resolveTagId`がタグ新規作成時に同マップからcodeを解決する前提と整合させるため
 * （在庫チェックだけ通っても、実際の生成→コミット時にタグ未登録エラーになっては意味がない）。
 */
export async function checkVocabInventory(
  supabase: SupabaseClient,
  threshold = DEFAULT_VOCAB_THRESHOLD,
  target = DEFAULT_VOCAB_TARGET,
): Promise<VocabTagInventory[]> {
  const { data: tags, error: tagsError } = await supabase.from('vocab_tags').select('id, name, code')
  if (tagsError) throw tagsError

  const results: VocabTagInventory[] = []
  for (const tag of (tags ?? []) as { id: number; name: string; code: string | null }[]) {
    if (!tag.code || !(tag.name in VOCAB_TAG_CODES)) {
      console.warn(
        `未登録のタグ(code未設定、またはvocabTagCodes.tsに無い名前): "${tag.name}" — 在庫チェック対象外としてスキップします。`,
      )
      continue
    }

    const { count, error: countError } = await supabase
      .from('vocab_word_tags')
      .select('vocab_word_id', { count: 'exact', head: true })
      .eq('tag_id', tag.id)
    if (countError) throw countError

    const actualCount = count ?? 0
    if (actualCount < threshold) {
      results.push({
        tagId: tag.id,
        tagName: tag.name,
        count: actualCount,
        shortfall: Math.max(0, target - actualCount),
      })
    }
  }
  return results
}
