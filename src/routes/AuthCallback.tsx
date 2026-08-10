import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        window.location.replace('/')
      }
    })

    // detectSessionInUrl already triggers the exchange on client init;
    // this covers the case where the session was already established
    // by the time this component mounts.
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setError(error.message)
        return
      }
      if (data.session) {
        window.location.replace('/')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      {error ? (
        <p className="text-sm text-incorrect-600">ログインに失敗しました: {error}</p>
      ) : (
        <p className="text-sm text-neutral-500">ログイン処理中...</p>
      )}
    </div>
  )
}
