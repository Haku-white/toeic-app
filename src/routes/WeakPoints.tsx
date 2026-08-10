import { Link, useLoaderData } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import {
  getGrammarCategoryStats,
  getVocabTagStats,
  type GrammarCategoryStat,
  type VocabTagStat,
} from '../lib/queries/weakPoints'

/** 9.6の方針: 正答率70%未満を警告色で強調する */
const WARNING_THRESHOLD = 0.7

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/**
 * 「計器盤」コンセプトの弧状メーター。正答率をトラック（neutral-300）に対する
 * 塗り分けで表現し、針色はStatRowのカード色と同じロジック（correct/incorrect）で
 * 一貫させる（紫は評価色と混同させないため使わない、DESIGN.md 20章参照）。
 */
function Gauge({ value, isWeak }: { value: number; isWeak: boolean }) {
  const clamped = Math.max(0, Math.min(1, value))
  const angle = Math.PI * clamped
  const x = (44 - 38 * Math.cos(angle)).toFixed(1)
  const y = (46 - 38 * Math.sin(angle)).toFixed(1)

  return (
    <svg width="56" height="33" viewBox="0 0 88 52" aria-hidden="true" className="shrink-0">
      <path
        d="M6 46 A38 38 0 0 1 82 46"
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        className="stroke-neutral-300"
      />
      {clamped > 0 && (
        <path
          d={`M6 46 A38 38 0 0 1 ${x} ${y}`}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={isWeak ? 'stroke-incorrect-600' : 'stroke-correct-600'}
        />
      )}
    </svg>
  )
}

function StatRow({
  label,
  totalAttempts,
  accuracyRate,
  to,
}: {
  label: string
  totalAttempts: number
  accuracyRate: number
  to: string
}) {
  const isWeak = accuracyRate < WARNING_THRESHOLD
  return (
    <Link
      to={to}
      className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm shadow-sm transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 ${
        isWeak ? 'border-incorrect-300 bg-incorrect-50 text-incorrect-900' : 'border-neutral-200 bg-white text-neutral-800'
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2">
        <Gauge value={accuracyRate} isWeak={isWeak} />
        <span className={`font-mono text-sm tabular-nums ${isWeak ? 'text-incorrect-700' : 'text-correct-700'}`}>
          {formatPercent(accuracyRate)}
        </span>
        <span className="font-mono text-xs tabular-nums text-neutral-500">（{totalAttempts}問）</span>
      </span>
    </Link>
  )
}

export default function WeakPoints() {
  const { session } = useLoaderData() as { session: Session }
  const userId = session.user.id

  const grammarQuery = useQuery({
    queryKey: ['grammar-category-stats', userId],
    queryFn: () => getGrammarCategoryStats(userId),
  })
  const vocabQuery = useQuery({
    queryKey: ['vocab-tag-stats', userId],
    queryFn: () => getVocabTagStats(userId),
  })

  const isLoading = grammarQuery.isLoading || vocabQuery.isLoading
  const isError = grammarQuery.isError || vocabQuery.isError

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">読み込み中...</p>
      </div>
    )
  }

  if (isError) {
    const error = grammarQuery.error ?? vocabQuery.error
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-sm text-incorrect-600">
          統計の取得に失敗しました: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }

  const grammarStats = grammarQuery.data as GrammarCategoryStat[]
  const vocabStats = vocabQuery.data as VocabTagStat[]

  return (
    <div className="flex min-h-screen flex-col items-center gap-8 bg-neutral-50 px-4 py-12">
      <h1 className="text-xl font-semibold text-neutral-900">弱点分析ダッシュボード</h1>

      <div className="grid w-full max-w-4xl gap-8 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">文法カテゴリ別正答率</h2>
          {grammarStats.length === 0 ? (
            <p className="text-sm text-neutral-500">まだ解答データがありません。</p>
          ) : (
            <div className="space-y-2">
              {grammarStats.map((stat) => (
                <StatRow
                  key={stat.categoryId}
                  label={stat.categoryName}
                  totalAttempts={stat.totalAttempts}
                  accuracyRate={stat.accuracyRate}
                  to={`/grammar/${stat.categoryCode}`}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">語彙タグ別正答率</h2>
          {vocabStats.length === 0 ? (
            <p className="text-sm text-neutral-500">まだレビューデータがありません。</p>
          ) : (
            <div className="space-y-2">
              {vocabStats.map((stat) => (
                <StatRow
                  key={stat.tagId}
                  label={stat.tagName}
                  totalAttempts={stat.totalReviews}
                  accuracyRate={stat.accuracyRate}
                  to={`/vocab/review/${encodeURIComponent(stat.tagCode)}`}
                />
              ))}
            </div>
          )}
        </section>
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
