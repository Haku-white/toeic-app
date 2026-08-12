import { Link, useLoaderData } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { assignShortcutKeys, useMenuShortcuts } from '../lib/useMenuShortcuts'

/** ログアウトは破壊的操作のためショートカット割り当ての対象外(意図しないキー押下でサインアウトしてほしくない)。 */
const NAV_LINKS = [
  { to: '/vocab/review', label: '語彙SRSレビューを始める' },
  { to: '/vocab/tags', label: '語彙タグ一覧から復習する' },
  { to: '/grammar', label: '文法ドリルを始める' },
  { to: '/weak-points', label: '弱点分析ダッシュボード' },
  { to: '/mixed-drill', label: '総合問題を始める' },
]

/** 5aヘッダーの街の光(装飾用ドット)の位置。デザイン原案の座標をそのまま踏襲。 */
const CITY_LIGHTS = [
  { left: '18%', bottom: '56px', glow: '0 0 3px 1px rgba(255,255,255,.6)' },
  { left: '26%', bottom: '48px', glow: '0 0 3px 1px rgba(255,255,255,.5)' },
  { left: '34%', bottom: '58px', glow: '0 0 4px 1px rgba(255,255,255,.65)' },
  { left: '44%', bottom: '44px', glow: '0 0 3px 1px rgba(255,255,255,.5)' },
  { left: '56%', bottom: '50px', glow: '0 0 4px 1px rgba(255,255,255,.6)' },
  { left: '66%', bottom: '40px', glow: '0 0 3px 1px rgba(255,255,255,.5)' },
  { left: '74%', bottom: '54px', glow: '0 0 4px 1px rgba(255,255,255,.65)' },
  { left: '83%', bottom: '46px', glow: '0 0 3px 1px rgba(255,255,255,.5)' },
]

export default function Home() {
  const { session } = useLoaderData() as { session: Session }
  const shortcutLinks = assignShortcutKeys(NAV_LINKS)
  useMenuShortcuts(shortcutLinks)

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-10">
      <div className="relative w-full max-w-md overflow-hidden rounded-[26px] bg-accent-50 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
        {/* パネル四隅のネジ(計器盤モチーフ) */}
        <span className="absolute left-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute right-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 left-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 right-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />

        {/* 5a 夜間飛行型ヘッダー: 夜の地球を見下ろす視点+航跡を残す機影 */}
        <div className="relative mb-[22px] h-[140px] overflow-hidden rounded-b-2xl bg-[linear-gradient(180deg,oklch(15%_0.025_300)_0%,oklch(19%_0.04_300)_55%,oklch(24%_0.06_300)_100%)]">
          <div className="absolute left-1/2 -bottom-[190px] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_50%_0%,oklch(38%_0.1_300)_0%,oklch(16%_0.035_300)_55%,oklch(9%_0.015_300)_100%)] shadow-[0_0_56px_10px_oklch(60%_0.15_300_/_.5)_inset]" />
          <div className="absolute left-1/2 -bottom-[190px] h-[3px] w-[420px] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,oklch(78%_0.13_300_/_.95),transparent)] blur-[1.5px]" />
          <div className="absolute left-1/2 -bottom-[186px] h-px w-[340px] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)]" />

          {CITY_LIGHTS.map((light, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute h-0.5 w-0.5 rounded-full bg-white"
              style={{ left: light.left, bottom: light.bottom, boxShadow: light.glow }}
            />
          ))}

          <svg viewBox="0 0 380 140" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <polyline
              points="30,96 90,84 150,68 205,52"
              fill="none"
              stroke="oklch(78% 0.03 300 / .45)"
              strokeWidth="1.5"
              strokeDasharray="1 6"
              strokeLinecap="round"
            />
          </svg>
          <div
            aria-hidden="true"
            className="absolute left-[205px] top-[47px] h-0 w-0 rotate-[-24deg] border-y-[5px] border-l-[10px] border-y-transparent border-l-[oklch(88%_0.015_300)]"
          />
          <div
            aria-hidden="true"
            className="absolute left-[200px] top-[50px] h-0.5 w-1.5 rotate-[56deg] rounded-[1px] bg-[oklch(88%_0.015_300)]"
          />

          <div className="absolute left-[26px] top-5">
            <p className="text-base font-bold text-[oklch(96%_0.006_300)]">ログイン成功</p>
            <p className="mt-1 font-mono text-xs text-[oklch(78%_0.02_300)]">{session.user.email}</p>
          </div>
        </div>

        <div className="px-6 pb-8 sm:px-7">
          <div className="mb-3.5 flex items-center justify-between rounded-md bg-[repeating-linear-gradient(135deg,var(--color-accent-200)_0px,var(--color-accent-200)_2px,var(--color-accent-100)_2px,var(--color-accent-100)_4px)] px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,.08)]">
            <span className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-accent-700">
              CONTROL PANEL
            </span>
            <div className="flex gap-[3px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="h-2.5 w-0.5 bg-accent-300" />
              ))}
            </div>
          </div>

          <nav className="flex flex-col gap-2.5">
            {shortcutLinks.map((link, i) => (
              <div key={link.to} className="flex items-center gap-2">
                <span className="w-3.5 flex-none text-right font-mono text-[10px] text-neutral-400">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 rounded-2xl bg-accent-100 p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,.09)]">
                  <Link
                    to={link.to}
                    className="flex h-[50px] items-center justify-between rounded-xl bg-white px-4 shadow-sm transition-transform hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="h-3.5 w-3.5 rounded-full bg-neutral-100 shadow-[inset_0_1px_2px_rgba(0,0,0,.12)] ring-1 ring-inset ring-neutral-300" />
                      <span className="text-sm font-semibold text-neutral-800">{link.label}</span>
                    </span>
                    {link.shortcutKey && (
                      <span className="flex h-[22px] w-[25px] items-center justify-center rounded-md border-b-2 border-neutral-300 bg-neutral-50 font-mono text-xs font-bold text-accent-700">
                        {link.shortcutKey}
                      </span>
                    )}
                  </Link>
                </div>
              </div>
            ))}
          </nav>

          <button
            onClick={handleSignOut}
            className="mx-auto mt-6 flex items-center gap-2 rounded-lg border border-neutral-300 px-5 py-2 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}
