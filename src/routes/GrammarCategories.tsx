import { Link, useLoaderData } from 'react-router-dom'
import { useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { getGrammarCategories, type GrammarCategory } from '../lib/queries/grammar'
import { getGrammarCategoryStats } from '../lib/queries/weakPoints'
import { assignShortcutKeys, useMenuShortcuts } from '../lib/useMenuShortcuts'

interface CategoryWithStats extends GrammarCategory {
  totalAttempts: number
  accuracyRate: number
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function CategoryRow({
  category,
  index,
  isLastOdd,
  shortcutKey,
}: {
  category: CategoryWithStats
  index: number
  isLastOdd: boolean
  shortcutKey: string | null
}) {
  const hasData = category.totalAttempts > 0

  return (
    <div className={`flex items-start gap-1.5 ${isLastOdd ? 'col-span-2' : ''}`}>
      <span className="w-3 flex-none pt-[13px] text-right font-mono text-[9px] text-neutral-400">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="flex-1 rounded-lg bg-accent-100 p-1 shadow-[inset_0_2px_3px_rgba(0,0,0,.2),inset_0_-1px_0_rgba(255,255,255,.4)]">
        <Link
          to={`/grammar/${category.code}`}
          className="flex min-h-[44px] flex-col gap-1.5 rounded-md bg-white px-2.5 py-2 shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="text-[12.5px] font-semibold leading-tight text-neutral-800">{category.nameJa}</span>
            {shortcutKey && (
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md border-b-2 border-neutral-300 bg-neutral-50 font-mono text-[10.5px] font-bold text-neutral-500">
                {shortcutKey}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200">
              {hasData && (
                <span className="block h-full rounded-full bg-accent-600" style={{ width: formatPercent(category.accuracyRate) }} />
              )}
            </span>
            <span className="flex-none font-mono text-[9px] tabular-nums text-neutral-500">
              {hasData ? formatPercent(category.accuracyRate) : '—'}
            </span>
          </div>
        </Link>
      </div>
    </div>
  )
}

export default function GrammarCategories() {
  const { session } = useLoaderData() as { session: Session }
  const userId = session.user.id

  const categoriesQuery = useQuery({ queryKey: ['grammar-categories'], queryFn: getGrammarCategories })
  const statsQuery = useQuery({
    queryKey: ['grammar-category-stats', userId],
    queryFn: () => getGrammarCategoryStats(userId),
  })

  const isLoading = categoriesQuery.isLoading || statsQuery.isLoading
  const isError = categoriesQuery.isError || statsQuery.isError

  const categories: CategoryWithStats[] = useMemo(() => {
    const statsByCategoryId = new Map((statsQuery.data ?? []).map((stat) => [stat.categoryId, stat]))
    return (categoriesQuery.data ?? []).map((category) => {
      const stat = statsByCategoryId.get(category.id)
      return { ...category, totalAttempts: stat?.totalAttempts ?? 0, accuracyRate: stat?.accuracyRate ?? 0 }
    })
  }, [categoriesQuery.data, statsQuery.data])

  // カテゴリ一覧 + 「ホームに戻る」を1つの連番シーケンスとして扱う（DOM順: カテゴリ→戻るリンク）。
  // isLoading/isErrorの早期returnより前でHooksを呼ぶ必要があるため、未取得の間は`?? []`相当のcategoriesで対応する。
  const shortcutItems = useMemo(
    () => assignShortcutKeys([...categories.map((category) => ({ to: `/grammar/${category.code}` })), { to: '/' }]),
    [categories],
  )
  useMenuShortcuts(shortcutItems)

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">読み込み中...</p>
      </div>
    )
  }

  if (isError) {
    const error = categoriesQuery.error ?? statsQuery.error
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-sm text-incorrect-600">
          カテゴリの取得に失敗しました: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="relative w-full max-w-md overflow-hidden rounded-[18px] bg-neutral-50 px-6 pb-7 pt-7 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
        {/* パネル四隅のネジ(計器盤モチーフ) */}
        <span className="absolute left-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute right-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 left-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 right-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />

        <h1 className="mb-3.5 text-base font-bold text-neutral-900">文法カテゴリ</h1>

        <div className="mb-4 flex items-center justify-between rounded-md bg-[repeating-linear-gradient(135deg,var(--color-accent-200)_0px,var(--color-accent-200)_2px,var(--color-accent-100)_2px,var(--color-accent-100)_4px)] px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,.08)]">
          <span className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-accent-700">
            GRAMMAR CATEGORIES
          </span>
          <div className="flex gap-[3px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="h-2.5 w-0.5 bg-accent-300" />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {categories.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              index={index}
              isLastOdd={index === categories.length - 1 && categories.length % 2 === 1}
              shortcutKey={shortcutItems[index].shortcutKey}
            />
          ))}
        </div>

        <Link
          to="/"
          className="mx-auto mt-[22px] flex w-fit items-center gap-2 text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          ホームに戻る
          {shortcutItems[categories.length]?.shortcutKey && (
            <span className="rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500">
              {shortcutItems[categories.length]?.shortcutKey}
            </span>
          )}
        </Link>
      </div>
    </div>
  )
}
