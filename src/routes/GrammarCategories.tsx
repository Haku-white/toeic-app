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

/** 街明かりの座標(SVG viewBox 0 0 380 140)。デザイン原案の座標・不透明度をそのまま踏襲。 */
const CITY_LIGHTS = [
  { cx: 30, cy: 130, r: 1.6, opacity: 0.85 },
  { cx: 95, cy: 122, r: 1.4, opacity: 0.8 },
  { cx: 160, cy: 132, r: 1.5, opacity: 0.85 },
  { cx: 235, cy: 126, r: 1.3, opacity: 0.75 },
  { cx: 300, cy: 134, r: 1.6, opacity: 0.85 },
  { cx: 345, cy: 120, r: 1.3, opacity: 0.75 },
  { cx: 60, cy: 105, r: 1.1, opacity: 0.7 },
  { cx: 130, cy: 100, r: 1, opacity: 0.65 },
  { cx: 200, cy: 108, r: 1.1, opacity: 0.7 },
  { cx: 270, cy: 98, r: 1, opacity: 0.65 },
  { cx: 320, cy: 103, r: 1.1, opacity: 0.7 },
  { cx: 105, cy: 85, r: 0.8, opacity: 0.55 },
  { cx: 170, cy: 80, r: 0.7, opacity: 0.5 },
  { cx: 230, cy: 86, r: 0.8, opacity: 0.55 },
  { cx: 150, cy: 66, r: 0.6, opacity: 0.45 },
  { cx: 205, cy: 68, r: 0.6, opacity: 0.45 },
  { cx: 178, cy: 50, r: 0.5, opacity: 0.4 },
]

/** 消失点(190,32)から街並みへ伸びる遠近グリッドの対角線。 */
const PERSPECTIVE_LINES = [
  [190, 32, -100, 140],
  [190, 32, -20, 140],
  [190, 32, 60, 140],
  [190, 32, 140, 140],
  [190, 32, 240, 140],
  [190, 32, 320, 140],
  [190, 32, 400, 140],
  [190, 32, 480, 140],
]

/** 街並みの水平方向のグリッド(道路・階層)。上に行くほど幅が狭まる。 */
const HORIZON_LINES = [
  [-70, 140, 450, 140],
  [0, 115, 380, 115],
  [50, 95, 330, 95],
  [90, 78, 290, 78],
  [120, 64, 260, 64],
  [142, 52, 238, 52],
  [160, 42, 220, 42],
]

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
      <span className="w-3 flex-none pt-[13px] text-right font-mono text-[9px] text-[oklch(52%_0.02_300)]">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="flex-1 rounded-xl bg-[oklch(26%_0.045_300)] p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,.35),inset_0_-1px_0_rgba(255,255,255,.05)]">
        <Link
          to={`/grammar/${category.code}`}
          className="rowhover relative flex min-h-[44px] flex-col gap-1.5 rounded-[9px] bg-[oklch(95%_0.005_300)] px-2.5 py-2 shadow-[0_1px_2px_rgba(0,0,0,.05)] transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <div className="flex items-start justify-between gap-1.5">
            <span className="flex items-start gap-1.5">
              <span
                aria-hidden="true"
                className="mt-0.5 h-3 w-3 flex-none rounded-full bg-[oklch(85%_0.14_95)] shadow-[0_0_6px_1px_oklch(85%_0.14_95_/_.65),inset_0_-1px_1px_rgba(0,0,0,.1)]"
              />
              <span className="text-[12.5px] font-semibold leading-tight text-[oklch(24%_0.015_300)]">
                {category.nameJa}
              </span>
            </span>
            {shortcutKey && (
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md border-b-2 border-[oklch(84%_0.008_300)] bg-[oklch(97%_0.003_300)] font-mono text-[10.5px] font-bold text-[oklch(42%_0.015_300)]">
                {shortcutKey}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-[oklch(88%_0.008_300)]">
              {hasData && (
                <span
                  className="block h-full bg-[linear-gradient(90deg,oklch(60%_0.14_300),oklch(46%_0.13_300))]"
                  style={{ width: formatPercent(category.accuracyRate) }}
                />
              )}
            </span>
            <span className="flex-none font-mono text-[9px] tabular-nums text-[oklch(48%_0.015_300)]">
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
      <div className="relative w-full max-w-md overflow-hidden rounded-[18px] bg-[linear-gradient(180deg,oklch(12%_0.02_300)_0%,oklch(15%_0.03_300)_16%,oklch(18%_0.035_300)_34%,oklch(19%_0.035_300)_100%)] shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
        {/* パネル四隅のネジ(計器盤モチーフ) */}
        <span className="absolute left-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-400" />
        <span className="absolute right-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-400" />
        <span className="absolute bottom-3 left-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-400" />
        <span className="absolute bottom-3 right-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-400" />

        <div className="relative px-[26px] pb-[26px] pt-[30px]">
          {/* 夜景バナー: 遠近グリッド+街明かりを見下ろして飛ぶ情景 */}
          <div className="pointer-events-none absolute left-0 top-0 h-40 w-full overflow-hidden">
            <svg viewBox="0 0 380 140" className="absolute inset-0 h-full w-full" aria-hidden="true">
              {PERSPECTIVE_LINES.map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="oklch(62% 0.13 300 / .4)" strokeWidth="1" />
              ))}
              {HORIZON_LINES.map(([x1, y1, x2, y2], i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="oklch(62% 0.13 300 / .35)" strokeWidth="1" />
              ))}
              {CITY_LIGHTS.map((light, i) => (
                <circle key={i} cx={light.cx} cy={light.cy} r={light.r} fill="oklch(85% 0.08 300)" opacity={light.opacity} />
              ))}
            </svg>
            <div className="absolute inset-x-0 top-6 h-5 bg-[linear-gradient(180deg,oklch(65%_0.13_300_/_.4),transparent)] blur-[4px]" />
            <div className="absolute inset-x-[8%] top-[38%] h-0.5 bg-[linear-gradient(90deg,transparent,oklch(80%_0.12_300_/_.8),transparent)] blur-[1px]" />
            <h1 className="absolute left-[26px] top-5 text-base font-bold text-[oklch(96%_0.006_300)]">文法カテゴリ</h1>
          </div>

          <div className="h-28" />

          <div className="mb-3.5 flex items-center justify-between rounded-md bg-[repeating-linear-gradient(135deg,oklch(24%_0.03_300)_0px,oklch(24%_0.03_300)_2px,oklch(28%_0.03_300)_2px,oklch(28%_0.03_300)_4px)] px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,.3)]">
            <span className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-[oklch(72%_0.02_300)]">
              GRAMMAR CATEGORIES
            </span>
            <div className="flex gap-[3px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="h-2.5 w-0.5 bg-[oklch(50%_0.02_300)]" />
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
            className="mx-auto mt-[22px] flex w-fit items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            <span className="text-[13px] font-semibold text-[oklch(78%_0.02_300)] underline">ホームに戻る</span>
            {shortcutItems[categories.length]?.shortcutKey && (
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md border-b-2 border-[oklch(84%_0.008_300)] bg-[oklch(95%_0.004_300)] font-mono text-[11px] font-bold text-[oklch(42%_0.015_300)]">
                {shortcutItems[categories.length]?.shortcutKey}
              </span>
            )}
          </Link>
        </div>

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_8%,transparent_55%,oklch(9%_0.015_300_/_.35)_100%)]" />
      </div>
    </div>
  )
}
