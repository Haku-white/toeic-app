import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthError } from '@supabase/supabase-js'
import Login from './Login'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}))

const { supabase } = await import('../lib/supabase')

beforeEach(() => {
  vi.mocked(supabase.auth.signInWithPassword).mockReset()
  vi.mocked(supabase.auth.signUp).mockReset()
  vi.mocked(supabase.auth.signInWithOAuth).mockReset()
  vi.mocked(supabase.auth.resetPasswordForEmail).mockReset()
})

describe('Login (パスワード再設定, 追加分)', () => {
  it('shows the password-reset request form when "パスワードをお忘れですか?" is clicked', () => {
    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'パスワードをお忘れですか?' }))

    expect(screen.getByText('パスワード再設定')).toBeInTheDocument()
    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument()
  })

  it('does not show the "パスワードをお忘れですか?" link in sign-up mode', () => {
    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを新規登録する' }))

    expect(screen.queryByRole('button', { name: 'パスワードをお忘れですか?' })).not.toBeInTheDocument()
  })

  it('submits the reset request with the entered email and shows a confirmation message', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null })

    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'パスワードをお忘れですか?' }))
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'リセットメールを送信' }))

    await waitFor(() => expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1))
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: expect.stringContaining('/reset-password'),
    })
    expect(await screen.findByText(/パスワード再設定用のメールを送信しました/)).toBeInTheDocument()
  })

  it('shows an error message when the reset request fails', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: null,
      error: { message: 'network down' } as AuthError,
    })

    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'パスワードをお忘れですか?' }))
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'リセットメールを送信' }))

    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('returns to the sign-in form via "ログインに戻る"', () => {
    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'パスワードをお忘れですか?' }))
    fireEvent.click(screen.getByRole('button', { name: 'ログインに戻る' }))

    expect(screen.getByLabelText('パスワード')).toBeInTheDocument()
  })
})
