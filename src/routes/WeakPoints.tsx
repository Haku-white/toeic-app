import { Link, useLoaderData } from 'react-router-dom'
import { useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import {
  getGrammarCategoryStats,
  getVocabTagStats,
  type GrammarCategoryStat,
  type VocabTagStat,
} from '../lib/queries/weakPoints'
import { assignShortcutKeys, useMenuShortcuts } from '../lib/useMenuShortcuts'

/** 9.6の方針: 正答率70%未満を警告色で強調する */
const WARNING_THRESHOLD = 0.7

/** r=15.9は2πr≈100となるため、strokeDasharrayに正答率(0-100)をそのまま渡せる（29章のセルフノートと同じ簡略化テクニック）。 */
const RING_RADIUS = 15.9

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/**
 * 「計器盤」コンセプトのドーナツ型リングメーター（claude.ai Design Canvas
 * 「弱点分析ダッシュボード再考2」8a案「リングメーター・グリッド型」を移植）。
 * 正答率をリングの残量塗り分け＋中央%表示で示す。配色は既存方針を踏襲し2階調
 * （correct/incorrect）のまま（DESIGN.md 20章参照、紫は評価色と混同させないため使わない）。
 */
function RingGauge({ value, isWeak }: { value: number; isWeak: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  const arcClass = isWeak ? 'stroke-incorrect-500' : 'stroke-correct-500'
  const textClass = isWeak ? 'text-incorrect-700' : 'text-correct-700'

  return (
    <div className="relative h-11 w-11 flex-none">
      <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={RING_RADIUS} fill="none" strokeWidth="5" className="stroke-neutral-300" />
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${pct} 100`}
          className={arcClass}
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center font-mono font-bold ${textClass} ${pct === 100 ? 'text-[9px]' : 'text-[10px]'}`}
      >
        {formatPercent(value)}
      </div>
    </div>
  )
}

function GaugeTile({
  label,
  totalAttempts,
  accuracyRate,
  to,
  shortcutKey,
}: {
  label: string
  totalAttempts: number
  accuracyRate: number
  to: string
  shortcutKey: string | null
}) {
  const isWeak = accuracyRate < WARNING_THRESHOLD
  return (
    <div className="rounded-lg bg-accent-100 p-1 shadow-[inset_0_2px_3px_rgba(0,0,0,.2),inset_0_-1px_0_rgba(255,255,255,.4)]">
      <Link
        to={to}
        className="flex items-center gap-2.5 rounded-md bg-white px-2.5 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        <RingGauge value={accuracyRate} isWeak={isWeak} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-neutral-800">{label}</span>
          <span className="block font-mono text-[9.5px] text-neutral-500">{totalAttempts}問</span>
        </span>
        {shortcutKey && (
          <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-md border-b-2 border-neutral-400 bg-neutral-200 font-mono text-[10px] font-bold text-neutral-800">
            {shortcutKey}
          </span>
        )}
      </Link>
    </div>
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

  // 文法セクション→語彙セクション→戻るリンクの順で1つの連番シーケンスとして扱う（DOM順どおり）。
  // isLoading/isErrorの早期returnより前でHooksを呼ぶ必要があるため、未取得の間は`?? []`で対応する。
  const shortcutItems = useMemo(
    () =>
      assignShortcutKeys([
        ...(grammarQuery.data ?? []).map((stat) => ({ to: `/grammar/${stat.categoryCode}` })),
        ...(vocabQuery.data ?? []).map((stat) => ({ to: `/vocab/review/${encodeURIComponent(stat.tagCode)}` })),
        { to: '/' },
      ]),
    [grammarQuery.data, vocabQuery.data],
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
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="relative w-full max-w-2xl rounded-[18px] bg-accent-50 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
        {/* パネル四隅のネジ(計器盤モチーフ) */}
        <span className="absolute left-3 top-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 left-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 right-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />

        <div className="px-6 pb-7 pt-7 sm:px-7">
          <h1 className="mb-3.5 text-base font-bold text-neutral-900">弱点分析ダッシュボード</h1>

          <div className="mb-4 flex items-center justify-between rounded-md bg-[repeating-linear-gradient(135deg,var(--color-accent-200)_0px,var(--color-accent-200)_2px,var(--color-accent-100)_2px,var(--color-accent-100)_4px)] px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,.08)]">
            <span className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-accent-700">WEAKPOINT GAUGES</span>
            <div className="flex gap-[3px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="h-2.5 w-0.5 bg-accent-300" />
              ))}
            </div>
          </div>

          <section className="mb-5">
            <h2 className="mb-2 font-mono text-[10px] tracking-[0.1em] text-neutral-500">文法カテゴリ</h2>
            {grammarStats.length === 0 ? (
              <p className="text-sm text-neutral-500">まだ解答データがありません。</p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {grammarStats.map((stat, index) => (
                  <GaugeTile
                    key={stat.categoryId}
                    label={stat.categoryName}
                    totalAttempts={stat.totalAttempts}
                    accuracyRate={stat.accuracyRate}
                    to={`/grammar/${stat.categoryCode}`}
                    shortcutKey={shortcutItems[index].shortcutKey}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-mono text-[10px] tracking-[0.1em] text-neutral-500">語彙タグ</h2>
            {vocabStats.length === 0 ? (
              <p className="text-sm text-neutral-500">まだレビューデータがありません。</p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {vocabStats.map((stat, index) => (
                  <GaugeTile
                    key={stat.tagId}
                    label={stat.tagName}
                    totalAttempts={stat.totalReviews}
                    accuracyRate={stat.accuracyRate}
                    to={`/vocab/review/${encodeURIComponent(stat.tagCode)}`}
                    shortcutKey={shortcutItems[grammarStats.length + index].shortcutKey}
                  />
                ))}
              </div>
            )}
          </section>

          <Link
            to="/"
            className="mx-auto mt-6 flex w-fit items-center gap-2 text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            ホームに戻る
            {shortcutItems[shortcutItems.length - 1]?.shortcutKey && (
              <span className="rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500">
                {shortcutItems[shortcutItems.length - 1]?.shortcutKey}
              </span>
            )}
          </Link>
        </div>
      </div>
    </div>
  )
}
