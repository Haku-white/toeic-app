import { Link, useLoaderData } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { assignShortcutKeys, useMenuShortcuts } from '../lib/useMenuShortcuts'

/** ログアウトは破壊的操作のためショートカット割り当ての対象外（意図しないキー押下でサインアウトしてほしくない）。 */
const NAV_LINKS = [
  { to: '/vocab/review', label: '語彙SRSレビューを始める', variant: 'primary' as const },
  { to: '/vocab/tags', label: '語彙タグ一覧から復習する', variant: 'secondary' as const },
  { to: '/grammar', label: '文法ドリルを始める', variant: 'secondary' as const },
  { to: '/weak-points', label: '弱点分析ダッシュボード', variant: 'secondary' as const },
  { to: '/mixed-drill', label: '総合問題を始める', variant: 'secondary' as const },
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
      <p className="text-lg font-semibold text-neutral-900">ログイン成功</p>
      <p className="text-sm text-neutral-600">{session.user.email}</p>
      {shortcutLinks.map((link) =>
        link.variant === 'primary' ? (
          <Link
            key={link.to}
            to={link.to}
            className="flex w-64 items-center justify-between gap-2 rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            <span>{link.label}</span>
            {link.shortcutKey && (
              <span className="rounded border border-white/40 px-1 font-mono text-xs text-white/80">
                {link.shortcutKey}
              </span>
            )}
          </Link>
        ) : (
          <Link
            key={link.to}
            to={link.to}
            className="flex w-64 items-center justify-between gap-2 rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-300 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            <span>{link.label}</span>
            {link.shortcutKey && (
              <span className="rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500">
                {link.shortcutKey}
              </span>
            )}
          </Link>
        ),
      )}
      <button
        onClick={handleSignOut}
        className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        ログアウト
      </button>
    </div>
  )
}
