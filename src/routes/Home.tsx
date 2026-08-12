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
      <div className="relative w-full max-w-md rounded-[26px] bg-accent-50 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
        {/* パネル四隅のネジ(計器盤モチーフ) */}
        <span className="absolute left-3 top-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 left-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />
        <span className="absolute bottom-3 right-3 h-1.5 w-1.5 rounded-full bg-neutral-300" />

        <div className="px-6 py-8 sm:px-7">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-correct-500 shadow-[0_0_6px_var(--color-correct-500)]" />
            <span className="text-base font-bold text-neutral-900">ログイン成功</span>
          </div>
          <p className="mb-4 font-mono text-xs text-neutral-500">{session.user.email}</p>

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
