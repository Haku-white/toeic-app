import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'reset'

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    console.log('[Login] handleSubmit fired', { mode, email })
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    console.log('[Login] calling supabase.auth', mode)
    const { data, error } =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })
    console.log('[Login] supabase.auth result', { data, error })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (mode === 'signup' && !data.session) {
      // メール確認が有効な環境ではsignUp直後はセッションが張られない。
      // ローカル(確認オフ)ではdata.sessionが返るため、下のelseで即ログイン扱いにする。
      setMessage('確認メールを送信しました。メール内のリンクからログインを完了してください。')
    } else {
      window.location.assign('/')
    }
  }

  async function handleResetRequest(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    // メール存在有無に関わらず同じ結果を返す(ユーザー列挙対策、Supabase標準の挙動)ため、
    // 成否に関わらず同一の案内文言を表示してよい。
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setMessage('パスワード再設定用のメールを送信しました。メール内のリンクから新しいパスワードを設定してください。')
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setMessage(null)
  }

  async function handleGoogleLogin() {
    console.log('[Login] handleGoogleLogin fired')
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setError(error.message)
  }

  if (mode === 'reset') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-xl font-semibold text-neutral-900">TOEIC学習アプリ</h1>
          <p className="mb-6 text-sm text-neutral-500">パスワード再設定</p>

          <form onSubmit={handleResetRequest} className="space-y-4">
            <div>
              <label htmlFor="reset-email" className="mb-1 block text-sm text-neutral-700">
                メールアドレス
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
              />
            </div>

            {error && <p className="text-sm text-incorrect-600">{error}</p>}
            {message && <p className="text-sm text-correct-700">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-accent-600 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            >
              リセットメールを送信
            </button>
          </form>

          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="mt-6 w-full text-center text-sm text-neutral-500 transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            ログインに戻る
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">TOEIC学習アプリ</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {mode === 'signin' ? 'ログイン' : '新規登録'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-neutral-700">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-neutral-700">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            />
          </div>

          {mode === 'signin' && (
            <button
              type="button"
              onClick={() => switchMode('reset')}
              className="text-xs text-neutral-500 transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            >
              パスワードをお忘れですか?
            </button>
          )}

          {error && <p className="text-sm text-incorrect-600">{error}</p>}
          {message && <p className="text-sm text-correct-700">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-accent-600 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            {mode === 'signin' ? 'ログイン' : '登録する'}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-neutral-200" />
          <span className="text-xs text-neutral-400">または</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          className="w-full rounded border border-neutral-300 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-accent-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          Googleでログイン
        </button>

        <button
          type="button"
          onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-6 w-full text-center text-sm text-neutral-500 transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          {mode === 'signin' ? 'アカウントを新規登録する' : 'すでにアカウントをお持ちの方はこちら'}
        </button>
      </div>
    </div>
  )
}
