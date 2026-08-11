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

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

const GAUGE_CENTER_X = 50
const GAUGE_CENTER_Y = 56
const GAUGE_ARC_RADIUS = 30
const GAUGE_TICK_INNER_RADIUS = 36
const GAUGE_TICK_OUTER_MINOR_RADIUS = 40
const GAUGE_TICK_OUTER_MAJOR_RADIUS = 43
const GAUGE_LABEL_RADIUS = 46
const GAUGE_NEEDLE_RADIUS = 24
const GAUGE_TICK_FRACTIONS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
const GAUGE_LABELS: { fraction: number; text: string }[] = [
  { fraction: 0, text: '0' },
  { fraction: 0.5, text: '50' },
  { fraction: 1, text: '100' },
]

function gaugePoint(fraction: number, radius: number) {
  const angle = Math.PI * fraction
  return {
    x: GAUGE_CENTER_X - radius * Math.cos(angle),
    y: GAUGE_CENTER_Y - radius * Math.sin(angle),
  }
}

/**
 * 「計器盤」コンセプトのアナログ針式メーター（DESIGN.md Design Canvas
 * 「Weakness Dashboard Gauges」1a案を移植）。正答率をトラック（neutral-300）に
 * 対する塗り分け＋針で表現する。配色は既存方針を踏襲し2階調（correct/incorrect）の
 * ままとし、1a案の3階調（green/amber/red）は採用しない。針色はStatRowのカード色と
 * 同じロジックで一貫させる（紫は評価色と混同させないため使わない、DESIGN.md 20章参照）。
 * 目盛りはminor/majorの2段階、ラベルは0/50/100の3点のみに間引いている。
 */
function Gauge({ value, isWeak }: { value: number; isWeak: boolean }) {
  const clamped = Math.max(0, Math.min(1, value))
  const start = gaugePoint(0, GAUGE_ARC_RADIUS)
  const end = gaugePoint(1, GAUGE_ARC_RADIUS)
  const valueEnd = gaugePoint(clamped, GAUGE_ARC_RADIUS)
  const needleTip = gaugePoint(clamped, GAUGE_NEEDLE_RADIUS)
  const needleColorClass = isWeak ? 'stroke-incorrect-600' : 'stroke-correct-600'

  return (
    <svg width="104" height="64" viewBox="0 0 100 62" aria-hidden="true" className="shrink-0">
      {GAUGE_TICK_FRACTIONS.map((fraction) => {
        const isMajor = fraction % 0.25 === 0
        const inner = gaugePoint(fraction, GAUGE_TICK_INNER_RADIUS)
        const outer = gaugePoint(fraction, isMajor ? GAUGE_TICK_OUTER_MAJOR_RADIUS : GAUGE_TICK_OUTER_MINOR_RADIUS)
        return (
          <line
            key={fraction}
            x1={inner.x.toFixed(1)}
            y1={inner.y.toFixed(1)}
            x2={outer.x.toFixed(1)}
            y2={outer.y.toFixed(1)}
            strokeWidth={isMajor ? 1.5 : 1}
            className={isMajor ? 'stroke-neutral-400' : 'stroke-neutral-300'}
          />
        )
      })}
      {GAUGE_LABELS.map(({ fraction, text }) => {
        const pos = gaugePoint(fraction, GAUGE_LABEL_RADIUS)
        return (
          <text
            key={text}
            x={pos.x.toFixed(1)}
            y={pos.y.toFixed(1)}
            fontSize="9"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-neutral-400"
          >
            {text}
          </text>
        )
      })}
      <path
        d={`M${start.x.toFixed(1)} ${start.y.toFixed(1)} A${GAUGE_ARC_RADIUS} ${GAUGE_ARC_RADIUS} 0 0 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        className="stroke-neutral-300"
      />
      {clamped > 0 && (
        <path
          d={`M${start.x.toFixed(1)} ${start.y.toFixed(1)} A${GAUGE_ARC_RADIUS} ${GAUGE_ARC_RADIUS} 0 0 1 ${valueEnd.x.toFixed(1)} ${valueEnd.y.toFixed(1)}`}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className={needleColorClass}
        />
      )}
      <line
        x1={GAUGE_CENTER_X}
        y1={GAUGE_CENTER_Y}
        x2={needleTip.x.toFixed(1)}
        y2={needleTip.y.toFixed(1)}
        strokeWidth="2"
        strokeLinecap="round"
        className={needleColorClass}
      />
      <circle cx={GAUGE_CENTER_X} cy={GAUGE_CENTER_Y} r="2.5" className="fill-neutral-600" />
    </svg>
  )
}

function StatRow({
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
    <Link
      to={to}
      className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm shadow-sm transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 ${
        isWeak ? 'border-incorrect-300 bg-incorrect-50 text-incorrect-900' : 'border-neutral-200 bg-white text-neutral-800'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="font-medium">{label}</span>
        {shortcutKey && (
          <span className="rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500">
            {shortcutKey}
          </span>
        )}
      </span>
      <span className="flex items-center gap-3">
        <Gauge value={accuracyRate} isWeak={isWeak} />
        <span className="flex flex-col items-end">
          <span
            className={`font-mono text-base font-semibold tabular-nums ${isWeak ? 'text-incorrect-700' : 'text-correct-700'}`}
          >
            {formatPercent(accuracyRate)}
          </span>
          <span className="font-mono text-xs tabular-nums text-neutral-500">（{totalAttempts}問）</span>
        </span>
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
    <div className="flex min-h-screen flex-col items-center gap-8 bg-neutral-50 px-4 py-12">
      <h1 className="text-xl font-semibold text-neutral-900">弱点分析ダッシュボード</h1>

      <div className="grid w-full max-w-4xl gap-8 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">文法カテゴリ別正答率</h2>
          {grammarStats.length === 0 ? (
            <p className="text-sm text-neutral-500">まだ解答データがありません。</p>
          ) : (
            <div className="space-y-2">
              {grammarStats.map((stat, index) => (
                <StatRow
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

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">語彙タグ別正答率</h2>
          {vocabStats.length === 0 ? (
            <p className="text-sm text-neutral-500">まだレビューデータがありません。</p>
          ) : (
            <div className="space-y-2">
              {vocabStats.map((stat, index) => (
                <StatRow
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
      </div>

      <Link
        to="/"
        className="text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        ホームに戻る
        {shortcutItems[shortcutItems.length - 1]?.shortcutKey && (
          <span className="ml-1 rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500">
            {shortcutItems[shortcutItems.length - 1]?.shortcutKey}
          </span>
        )}
      </Link>
    </div>
  )
}
