import { redirect } from 'react-router-dom'
import { supabase } from './supabase'

/** 9.3の方針: 認証ガードはRouterのloader内でセッションを確認し、未ログイン時は/loginへリダイレクトする */
export async function requireSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    throw redirect('/login')
  }
  return { session }
}
