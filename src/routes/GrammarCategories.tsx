import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getGrammarCategories } from '../lib/queries/grammar'
import { assignShortcutKeys, useMenuShortcuts } from '../lib/useMenuShortcuts'

export default function GrammarCategories() {
  const { data: categories, isLoading, isError, error } = useQuery({
    queryKey: ['grammar-categories'],
    queryFn: getGrammarCategories,
  })

  // カテゴリ一覧 + 「ホームに戻る」を1つの連番シーケンスとして扱う（DOM順: カテゴリ→戻るリンク）。
  // isLoading/isErrorの早期returnより前でHooksを呼ぶ必要があるため、categoriesが未取得の間は`?? []`で対応する。
  const shortcutItems = useMemo(
    () => assignShortcutKeys([...(categories ?? []).map((category) => ({ to: `/grammar/${category.code}` })), { to: '/' }]),
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-sm text-incorrect-600">
          カテゴリの取得に失敗しました: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-neutral-50 px-4 py-12">
      <h1 className="text-xl font-semibold text-neutral-900">文法カテゴリ</h1>

      <div className="w-full max-w-md space-y-2">
        {categories!.map((category, index) => (
          <Link
            key={category.id}
            to={`/grammar/${category.code}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:border-accent-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            <span>{category.nameJa}</span>
            {shortcutItems[index].shortcutKey && (
              <span className="rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500">
                {shortcutItems[index].shortcutKey}
              </span>
            )}
          </Link>
        ))}
      </div>

      <Link
        to="/"
        className="text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        ホームに戻る
        {shortcutItems[categories!.length]?.shortcutKey && (
          <span className="ml-1 rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500">
            {shortcutItems[categories!.length]?.shortcutKey}
          </span>
        )}
      </Link>
    </div>
  )
}
