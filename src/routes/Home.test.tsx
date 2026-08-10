import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import Home from './Home'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}))

const { supabase } = await import('../lib/supabase')

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderHome() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Home />, loader: () => ({ session: fakeSession }) },
      { path: '/vocab/review', element: <div>vocab review screen</div> },
      { path: '/vocab/tags', element: <div>vocab tags screen</div> },
      { path: '/grammar', element: <div>grammar categories screen</div> },
      { path: '/weak-points', element: <div>weak points screen</div> },
      { path: '/mixed-drill', element: <div>mixed drill screen</div> },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.mocked(supabase.auth.signOut).mockReset().mockResolvedValue({ error: null } as never)
  // jsdomは実際のページ遷移を実装していないため、location.assign呼び出し自体をスタブして
  // "Not implemented: navigation"警告を避ける
  vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Home', () => {
  it('shows the 5 nav links with sequential A-E shortcut badges (ログアウト excluded)', async () => {
    renderHome()
    expect(await screen.findByText('ログイン成功')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /語彙SRSレビューを始める/ })).toHaveTextContent('A')
    expect(screen.getByRole('link', { name: /語彙タグ一覧から復習する/ })).toHaveTextContent('B')
    expect(screen.getByRole('link', { name: /文法ドリルを始める/ })).toHaveTextContent('C')
    expect(screen.getByRole('link', { name: /弱点分析ダッシュボード/ })).toHaveTextContent('D')
    expect(screen.getByRole('link', { name: /総合問題を始める/ })).toHaveTextContent('E')
    // ログアウトはショートカット割り当ての対象外(破壊的操作のため)
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
  })

  it('navigates via the assigned shortcut key (C -> /grammar)', async () => {
    renderHome()
    expect(await screen.findByText('ログイン成功')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'c' })

    expect(await screen.findByText('grammar categories screen')).toBeInTheDocument()
  })

  it('does not sign out when an unassigned key is pressed (logout has no shortcut)', async () => {
    renderHome()
    expect(await screen.findByText('ログイン成功')).toBeInTheDocument()

    // A-Eのみ使用中なので、範囲外のキーを押してもsignOutは呼ばれない
    fireEvent.keyDown(window, { key: 'z' })

    expect(supabase.auth.signOut).not.toHaveBeenCalled()
  })

  it('still signs out via clicking the logout button', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'ログアウト' }))

    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1)
  })
})
