import type { VocabProgressStats } from '../lib/queries/vocab'

/**
 * 語彙のSRS進捗（FSRS状態分布・安定度・期日到来枚数）を可視化する共通コンポーネント（DESIGN.md 31章）。
 * 「2a 計器編隊型」（`SessionSummary.tsx`が実装済みのレイアウト言語、主計器+副計器を横に並べる構成）を
 * 土台に、SRS指標向けに新規デザインした。`full`（`VocabTagList.tsx`に常設）と`compact`
 * （`VocabReview.tsx`のセッション完了画面）の2バリアントを持つ。
 */

interface VocabProgressHubProps {
  variant: 'full' | 'compact'
  stats: VocabProgressStats
  /** compact専用: セッション開始時点のスナップショット。渡すと差分バッジを表示する */
  before?: VocabProgressStats
}

const RING_RADIUS = 40
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function masteryRate(stats: VocabProgressStats): number {
  if (stats.totalWords === 0) return 0
  return (stats.reviewCount + stats.relearningCount) / stats.totalWords
}

function formatStability(days: number): string {
  return `${days.toFixed(1)}日`
}

function formatDelta(delta: number): string | null {
  if (delta === 0) return null
  return delta > 0 ? `+${delta}` : `${delta}`
}

interface StateRowSpec {
  key: 'newCount' | 'learningCount' | 'reviewCount' | 'relearningCount'
  label: string
  barClass: string
  textClass: string
}

/** New=neutral(未着手)・Learning=accent(進行中)・Review=correct(定着)・Relearning=incorrect(再学習)。
 * 新規の色相トークンは追加せず、既存のセマンティックトークンに割り当てる（31.4参照）。 */
const STATE_ROWS: StateRowSpec[] = [
  { key: 'newCount', label: '新規', barClass: 'bg-neutral-400', textClass: 'text-neutral-600' },
  { key: 'learningCount', label: '学習中', barClass: 'bg-accent-400', textClass: 'text-accent-700' },
  { key: 'reviewCount', label: '復習', barClass: 'bg-correct-500', textClass: 'text-correct-700' },
  { key: 'relearningCount', label: '再学習', barClass: 'bg-incorrect-500', textClass: 'text-incorrect-700' },
]

function MasteryRing({ rate, compact }: { rate: number; compact: boolean }) {
  const dashOffset = RING_CIRCUMFERENCE * (1 - rate)
  const outerClass = compact
    ? 'relative h-16 w-16 flex-none rounded-full bg-[repeating-conic-gradient(from_0deg,var(--color-neutral-300)_0deg_1.4deg,transparent_1.4deg_18deg)]'
    : 'relative h-28 w-28 flex-none rounded-full bg-[repeating-conic-gradient(from_0deg,var(--color-neutral-300)_0deg_1.4deg,transparent_1.4deg_18deg)]'
  const svgClass = compact
    ? 'absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)] -rotate-90'
    : 'absolute inset-[7px] h-[calc(100%-14px)] w-[calc(100%-14px)] -rotate-90'
  const holeClass = compact
    ? 'absolute inset-2.5 flex flex-col items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,.07)]'
    : 'absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,.07)]'
  const pctClass = compact ? 'font-mono text-sm font-bold tabular-nums text-neutral-900' : 'font-mono text-xl font-bold tabular-nums text-neutral-900'

  return (
    <div className={outerClass}>
      <svg viewBox="0 0 100 100" className={svgClass} aria-hidden="true">
        <circle cx="50" cy="50" r={RING_RADIUS} fill="none" strokeWidth="9" className="stroke-neutral-200" />
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className="stroke-accent-600"
        />
      </svg>
      <div className={holeClass}>
        <div className="flex items-baseline gap-0.5">
          <span className={pctClass}>{Math.round(rate * 100)}</span>
          <span className="font-mono text-[11px] font-bold text-neutral-900">%</span>
        </div>
        {!compact && <span className="mt-0.5 font-mono text-[9px] tracking-[0.08em] text-neutral-500">定着率</span>}
      </div>
    </div>
  )
}

function LcdPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-0.5 rounded-[10px] bg-neutral-900 px-3.5 py-2 shadow-[inset_0_1px_2px_rgba(0,0,0,.35)]">
      <p className="font-mono text-[9px] font-bold tracking-[0.1em] text-accent-400/70">{label}</p>
      <p className="font-mono text-lg font-bold tabular-nums text-accent-200">{value}</p>
    </div>
  )
}

function StateBreakdownRow({
  row,
  count,
  total,
  delta,
}: {
  row: StateRowSpec
  count: number
  total: number
  delta: number | null
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  const deltaLabel = delta !== null ? formatDelta(delta) : null

  return (
    <div className="flex items-center gap-2.5">
      <span className="w-11 flex-none text-xs font-semibold text-neutral-700">{row.label}</span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
        <span className={`block h-full rounded-full ${row.barClass}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`flex-none text-right font-mono text-[11px] font-bold tabular-nums ${row.textClass}`}>
        {count}
        {deltaLabel && <span className="ml-1 text-[10px] text-accent-600">{deltaLabel}</span>}
      </span>
    </div>
  )
}

export default function VocabProgressHub({ variant, stats, before }: VocabProgressHubProps) {
  const rate = masteryRate(stats)
  const rateBefore = before ? masteryRate(before) : null
  const ratePointDelta = rateBefore !== null ? Math.round(rate * 100) - Math.round(rateBefore * 100) : null

  if (variant === 'compact') {
    return (
      <div className="w-full max-w-md rounded-[14px] bg-neutral-50 px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
        <p className="mb-3 font-mono text-[9px] font-bold tracking-[0.14em] text-accent-700">SESSION IMPACT</p>
        <div className="flex items-center gap-3.5">
          <MasteryRing rate={rate} compact />
          <div className="flex-1">
            <p className="text-xs text-neutral-500">定着率</p>
            <p className="flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-bold tabular-nums text-neutral-900">
                {Math.round(rate * 100)}%
              </span>
              {ratePointDelta !== null && ratePointDelta > 0 && (
                <span className="font-mono text-xs font-bold text-correct-600">+{ratePointDelta}pt</span>
              )}
            </p>
          </div>
        </div>
        <div className="mt-3.5 flex flex-col gap-1.5">
          {STATE_ROWS.map((row) => (
            <StateBreakdownRow
              key={row.key}
              row={row}
              count={stats[row.key]}
              total={stats.totalWords}
              delta={before ? stats[row.key] - before[row.key] : null}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md rounded-[18px] bg-neutral-50 px-6 pb-6 pt-5 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
      <div className="mb-4 flex items-center justify-between rounded-md bg-[repeating-linear-gradient(135deg,var(--color-accent-200)_0px,var(--color-accent-200)_2px,var(--color-accent-100)_2px,var(--color-accent-100)_4px)] px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,.08)]">
        <span className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-accent-700">SRS PROGRESS</span>
        <div className="flex gap-[3px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="h-2.5 w-0.5 bg-accent-300" />
          ))}
        </div>
      </div>

      <div className="flex gap-3.5">
        <MasteryRing rate={rate} compact={false} />
        <div className="flex flex-1 flex-col gap-2">
          <LcdPanel label="本日の期日到来" value={`${stats.dueCount}件`} />
          <LcdPanel label="平均安定度" value={formatStability(stats.averageStability)} />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="font-mono text-[10px] font-bold tracking-[0.1em] text-neutral-500">State Breakdown</p>
        {STATE_ROWS.map((row) => (
          <StateBreakdownRow key={row.key} row={row} count={stats[row.key]} total={stats.totalWords} delta={null} />
        ))}
      </div>
    </div>
  )
}
