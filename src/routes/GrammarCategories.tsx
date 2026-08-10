import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getGrammarCategories } from '../lib/queries/grammar'

export default function GrammarCategories() {
  const { data: categories, isLoading, isError, error } = useQuery({
    queryKey: ['grammar-categories'],
    queryFn: getGrammarCategories,
  })

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
        {categories!.map((category) => (
          <Link
            key={category.id}
            to={`/grammar/${category.code}`}
            className="block rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:border-accent-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            {category.nameJa}
          </Link>
        ))}
      </div>

      <Link
        to="/"
        className="text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        ホームに戻る
      </Link>
    </div>
  )
}
