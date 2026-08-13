import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/**
 * パスワード再設定メールのリンク先（`Login.tsx`の`resetPasswordForEmail`の`redirectTo`）。
 * PKCEフローのため、マウント時点で`detectSessionInUrl`によりURL中の`code`が既に交換済み
 * （`AuthCallback.tsx`と同じ前提）か、`onAuthStateChange`の`PASSWORD_RECOVERY`イベントで
 * 判明する。認証必須ルート（`requireSession`）は使わない——リンクが無効/期限切れの場合に
 * 汎用的な/loginリダイレクトへ吸収されてしまい、専用のエラーメッセージを出せなくなるため。
 */
function getUrlError(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('error_description') ?? params.get('error')
}

export default function ResetPassword() {
  const [isReady, setIsReady] = useState(false)
  // URLのエラーパラメータは外部状態(window.location)の読み取りであり、レンダー中に安全に計算できる
  // ため、useState初期化関数で同期的に求める（effect内でのsetStateを避けるため、下のeffectでは
  // 改めてgetUrlError()を呼んで早期returnの判定に使う）。
  const [linkError, setLinkError] = useState<string | null>(getUrlError)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isDone, setIsDone] = useState(false)

  useEffect(() => {
    if (getUrlError()) return

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsReady(true)
      }
    })

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setLinkError(error.message)
        return
      }
      if (data.session) {
        setIsReady(true)
      } else {
        setLinkError('リンクが無効か、有効期限が切れています。もう一度パスワード再設定をお試しください。')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('パスワードが一致しません。')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setIsDone(true)
  }

  if (linkError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-xl font-semibold text-neutral-900">TOEIC学習アプリ</h1>
          <p className="mb-6 text-sm text-incorrect-600">{linkError}</p>
          <a
            href="/login"
            className="block w-full rounded bg-accent-600 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            ログイン画面へ
          </a>
        </div>
      </div>
    )
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-xl font-semibold text-neutral-900">TOEIC学習アプリ</h1>
          <p className="mb-6 text-sm text-correct-700">パスワードを更新しました。</p>
          <a
            href="/"
            className="block w-full rounded bg-accent-600 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            ホームに戻る
          </a>
        </div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">確認中...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">TOEIC学習アプリ</h1>
        <p className="mb-6 text-sm text-neutral-500">新しいパスワードを設定</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm text-neutral-700">
              新しいパスワード
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1 block text-sm text-neutral-700">
              新しいパスワード（確認）
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            />
          </div>

          {error && <p className="text-sm text-incorrect-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-accent-600 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            パスワードを更新する
          </button>
        </form>
      </div>
    </div>
  )
}
