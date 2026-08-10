import { Link, useLoaderData } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export default function Home() {
  const { session } = useLoaderData() as { session: Session }

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
      <p className="text-lg font-semibold text-neutral-900">ログイン成功</p>
      <p className="text-sm text-neutral-600">{session.user.email}</p>
      <Link
        to="/vocab/review"
        className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        語彙SRSレビューを始める
      </Link>
      <Link
        to="/vocab/tags"
        className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-300 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        語彙タグ一覧から復習する
      </Link>
      <Link
        to="/grammar"
        className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-300 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        文法ドリルを始める
      </Link>
      <Link
        to="/weak-points"
        className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-300 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        弱点分析ダッシュボード
      </Link>
      <Link
        to="/mixed-drill"
        className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-300 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        総合問題を始める
      </Link>
      <button
        onClick={handleSignOut}
        className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        ログアウト
      </button>
    </div>
  )
}
