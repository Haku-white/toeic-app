import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthError, Session, Subscription, User } from '@supabase/supabase-js'
import ResetPassword from './ResetPassword'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}))

const { supabase } = await import('../lib/supabase')

// supabase-js の Session/User/Subscription/AuthError は必須フィールドが多く、UIの振る舞い検証には
// 無関係なため、モック値はテスト対象の型に合わせてキャストして使う（本物のSDK契約検証はしない）。
const fakeSession = {} as Session
const fakeUser = {} as User

beforeEach(() => {
  vi.mocked(supabase.auth.getSession).mockReset()
  vi.mocked(supabase.auth.updateUser).mockReset()
  vi.mocked(supabase.auth.onAuthStateChange)
    .mockReset()
    .mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } as unknown as Subscription },
    })
  window.history.replaceState({}, '', '/reset-password')
})

describe('ResetPassword', () => {
  it('shows a loading state before the recovery session is confirmed', () => {
    vi.mocked(supabase.auth.getSession).mockReturnValue(new Promise(() => {})) // 解決しないままにする
    render(<ResetPassword />)
    expect(screen.getByText('確認中...')).toBeInTheDocument()
  })

  it('shows the new-password form once a session is present', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: fakeSession }, error: null })
    render(<ResetPassword />)
    expect(await screen.findByRole('button', { name: 'パスワードを更新する' })).toBeInTheDocument()
  })

  it('shows a link-expired error (from the URL) and a link back to /login, without calling getSession', async () => {
    window.history.replaceState(
      {},
      '',
      '/reset-password?error=access_denied&error_description=Email+link+is+invalid+or+has+expired',
    )
    render(<ResetPassword />)

    expect(await screen.findByText('Email link is invalid or has expired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ログイン画面へ' })).toHaveAttribute('href', '/login')
    expect(supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('shows an expired-link message when no session is established and no URL error is present', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null })
    render(<ResetPassword />)

    expect(await screen.findByText(/リンクが無効か、有効期限が切れています/)).toBeInTheDocument()
  })

  it('validates that the two password fields match before calling updateUser', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: fakeSession }, error: null })
    render(<ResetPassword />)

    fireEvent.change(await screen.findByLabelText('新しいパスワード'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByLabelText('新しいパスワード（確認）'), { target: { value: 'password2' } })
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを更新する' }))

    expect(await screen.findByText('パスワードが一致しません。')).toBeInTheDocument()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
  })

  it('updates the password and shows a success screen with a link home', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: fakeSession }, error: null })
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: { user: fakeUser }, error: null })
    render(<ResetPassword />)

    fireEvent.change(await screen.findByLabelText('新しいパスワード'), { target: { value: 'newpassword' } })
    fireEvent.change(screen.getByLabelText('新しいパスワード（確認）'), { target: { value: 'newpassword' } })
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを更新する' }))

    await waitFor(() => expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'newpassword' }))
    expect(await screen.findByText('パスワードを更新しました。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ホームに戻る' })).toHaveAttribute('href', '/')
  })

  it('shows an error message when updateUser fails', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: fakeSession }, error: null })
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: null },
      error: { message: 'weak password' } as AuthError,
    })
    render(<ResetPassword />)

    fireEvent.change(await screen.findByLabelText('新しいパスワード'), { target: { value: 'newpassword' } })
    fireEvent.change(screen.getByLabelText('新しいパスワード（確認）'), { target: { value: 'newpassword' } })
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを更新する' }))

    expect(await screen.findByText('weak password')).toBeInTheDocument()
  })
})
