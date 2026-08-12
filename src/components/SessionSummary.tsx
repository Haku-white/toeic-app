import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * ドリルセッション終了時の結果パネル（計器盤コンセプト「2a 計器編隊型」案、DESIGN.md 28章）。
 * GrammarDrill・MixedDrillの「セッション完了」画面から共通利用する。
 */

export interface SessionSummaryCategory {
  label: string
  correct: number
  total: number
}

interface SessionSummaryProps {
  correctCount: number
  totalCount: number
  /** セッション開始からの経過時間(ms)。未計測(取得前の一瞬)の間はnull。 */
  elapsedMs: number | null
  /** MixedDrillの文法/語彙のような内訳。単一カテゴリのGrammarDrillでは省略する。 */
  categories?: SessionSummaryCategory[]
  /** カード下部に埋め込む操作ボタン群。SessionSummaryActionを並べる想定。 */
  actions?: ReactNode
}

/** WeakPoints.tsxのWARNING_THRESHOLDと同じ閾値（9.6の方針）。正答率この値未満を警告色にする。 */
const WARNING_THRESHOLD = 0.7

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** 円形速度計(正答率)のSVGジオメトリ。WeakPoints.tsxのGaugeコンポーネントと同じ「stroke-dasharrayで塗り分け」方式。 */
const GAUGE_RADIUS = 40
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS

export default function SessionSummary({ correctCount, totalCount, elapsedMs, categories, actions }: SessionSummaryProps) {
  const accuracyRate = totalCount > 0 ? correctCount / totalCount : 0
  const isWeak = accuracyRate < WARNING_THRESHOLD
  const tone = isWeak ? 'incorrect' : 'correct'
  const arcStrokeClass = isWeak ? 'stroke-incorrect-500' : 'stroke-correct-500'
  const arcDashOffset = GAUGE_CIRCUMFERENCE * (1 - accuracyRate)

  return (
    <div className="w-full max-w-md rounded-[18px] bg-neutral-50 px-6 pb-6 pt-7 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
      {/* 水平線バナー: 上昇する航跡で「飛んでいく」感覚を表現 */}
      <div className="relative mb-5 h-[62px] overflow-hidden rounded-xl bg-[linear-gradient(180deg,var(--color-accent-100)_0%,var(--color-accent-100)_60%,var(--color-accent-600)_60%,var(--color-accent-900)_100%)]">
        <div className="absolute inset-x-0 top-[60%] h-px bg-white/50" />
        <svg viewBox="0 0 380 62" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <polyline
            points="8,54 90,50 170,44 250,34 320,22 360,10"
            fill="none"
            stroke="rgba(255,255,255,.55)"
            strokeWidth="2"
            strokeDasharray="1 7"
            strokeLinecap="round"
          />
          <circle cx="360" cy="10" r="4" fill="#fff" />
        </svg>
        <div className="absolute left-4 top-2 leading-none">
          <p className="font-mono text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-accent-800/80">
            Session Log
          </p>
          <p className="mt-1 text-[13px] font-bold leading-none text-neutral-900">本日のセッションを記録しました</p>
        </div>
      </div>

      <div className="flex gap-3.5">
        {/* 主計器: 円形速度計(正答率)。WeakPoints.tsxのGaugeと同じstroke-dasharray方式のSVG */}
        <div className="relative h-28 w-28 flex-none rounded-full bg-[repeating-conic-gradient(from_0deg,var(--color-neutral-300)_0deg_1.4deg,transparent_1.4deg_18deg)]">
          <svg
            data-testid="accuracy-ring"
            data-tone={tone}
            viewBox="0 0 100 100"
            className="absolute inset-[7px] h-[calc(100%-14px)] w-[calc(100%-14px)] -rotate-90"
            aria-hidden="true"
          >
            <circle cx="50" cy="50" r={GAUGE_RADIUS} fill="none" strokeWidth="9" className="stroke-neutral-200" />
            <circle
              cx="50"
              cy="50"
              r={GAUGE_RADIUS}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={GAUGE_CIRCUMFERENCE}
              strokeDashoffset={arcDashOffset}
              className={arcStrokeClass}
            />
          </svg>
          <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,.07)]">
            <div className="flex items-baseline gap-0.5">
              <span className="font-mono text-xl font-bold tabular-nums text-neutral-900">
                {Math.round(accuracyRate * 100)}
              </span>
              <span className="font-mono text-[11px] font-bold text-neutral-900">%</span>
            </div>
            <span className="mt-0.5 font-mono text-[9px] tracking-[0.08em] text-neutral-500">正答率</span>
          </div>
        </div>

        {/* 副計器: LCD高度計風の経過時間・出題数パネル */}
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-1 flex-col justify-center gap-0.5 rounded-[10px] bg-neutral-900 px-3.5 py-2 shadow-[inset_0_1px_2px_rgba(0,0,0,.35)]">
            <p className="font-mono text-[9px] font-bold tracking-[0.1em] text-accent-400/70">かかった時間</p>
            <p className="font-mono text-lg font-bold tabular-nums text-accent-200">
              {elapsedMs === null ? '—:—' : formatElapsed(elapsedMs)}
            </p>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-0.5 rounded-[10px] bg-neutral-900 px-3.5 py-2 shadow-[inset_0_1px_2px_rgba(0,0,0,.35)]">
            <p className="font-mono text-[9px] font-bold tracking-[0.1em] text-accent-400/70">出題 / 正答</p>
            <p className="font-mono text-lg font-bold tabular-nums text-accent-200">
              {totalCount} / {correctCount}
            </p>
          </div>
        </div>
      </div>

      {categories && categories.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="font-mono text-[10px] font-bold tracking-[0.1em] text-neutral-500">Category Breakdown</p>
          {categories.map((cat) => {
            const rate = cat.total > 0 ? cat.correct / cat.total : 0
            const barClass =
              rate < WARNING_THRESHOLD
                ? 'block h-full rounded-full bg-gradient-to-r from-incorrect-600 to-incorrect-400'
                : 'block h-full rounded-full bg-gradient-to-r from-correct-600 to-correct-400'
            return (
              <div key={cat.label} className="flex items-center gap-2.5">
                <span className="w-11 flex-none text-xs font-semibold text-neutral-700">{cat.label}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                  <span className={barClass} style={{ width: `${Math.round(rate * 100)}%` }} />
                </span>
                <span className="w-8 flex-none text-right font-mono text-[11px] font-bold tabular-nums text-neutral-600">
                  {Math.round(rate * 100)}%
                </span>
              </div>
            )
          })}
        </div>
      )}

      {actions && <div className="mt-5">{actions}</div>}
    </div>
  )
}

/** SessionSummaryのactionsスロットに渡す操作ボタン。「取り付けネジ付きベゼル」の計器盤モチーフで統一する。 */
export function SessionSummaryAction({
  to,
  variant,
  children,
}: {
  to: string
  variant: 'primary' | 'secondary'
  children: ReactNode
}) {
  return (
    <div className="rounded-xl bg-accent-100 p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,.08),inset_0_-1px_0_#fff]">
      <Link
        to={to}
        className={
          variant === 'primary'
            ? 'flex h-11 items-center justify-center rounded-lg bg-gradient-to-b from-accent-700 to-accent-900 text-sm font-bold text-white transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500'
            : 'flex h-11 items-center justify-center rounded-lg bg-white text-sm font-semibold text-neutral-700 shadow-sm transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500'
        }
      >
        {children}
      </Link>
    </div>
  )
}
