import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import GrammarCategories from './GrammarCategories'

vi.mock('../lib/queries/grammar', () => ({
  getGrammarCategories: vi.fn(),
}))
vi.mock('../lib/queries/weakPoints', () => ({
  getGrammarCategoryStats: vi.fn(),
}))

const { getGrammarCategories } = await import('../lib/queries/grammar')
const { getGrammarCategoryStats } = await import('../lib/queries/weakPoints')

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderGrammarCategories() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/grammar', element: <GrammarCategories />, loader: () => ({ session: fakeSession }) },
      { path: '/grammar/:categoryCode', element: <div>drill screen</div> },
      { path: '/', element: <div>home screen</div> },
    ],
    { initialEntries: ['/grammar'] },
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getGrammarCategories).mockReset()
  vi.mocked(getGrammarCategoryStats).mockReset().mockResolvedValue([])
})

describe('GrammarCategories', () => {
  it('lists all categories as links to their drill route', async () => {
    vi.mocked(getGrammarCategories).mockResolvedValue([
      { id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 },
      { id: 2, code: 'voice', nameJa: '態(能動・受動)', sortOrder: 2 },
    ])

    renderGrammarCategories()

    const tenseLink = await screen.findByRole('link', { name: /時制/ })
    expect(tenseLink).toHaveAttribute('href', '/grammar/tense')

    const voiceLink = screen.getByRole('link', { name: /態\(能動・受動\)/ })
    expect(voiceLink).toHaveAttribute('href', '/grammar/voice')
  })

  it('shows an error message when the query fails', async () => {
    vi.mocked(getGrammarCategories).mockRejectedValue(new Error('network down'))
    renderGrammarCategories()
    expect(await screen.findByText(/カテゴリの取得に失敗しました/)).toBeInTheDocument()
  })

  it('assigns sequential A, B... shortcut keys to categories then the back link, and navigates on keypress', async () => {
    vi.mocked(getGrammarCategories).mockResolvedValue([
      { id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 },
      { id: 2, code: 'voice', nameJa: '態(能動・受動)', sortOrder: 2 },
    ])

    renderGrammarCategories()

    const tenseLink = await screen.findByRole('link', { name: /時制/ })
    expect(tenseLink).toHaveTextContent('A')
    const voiceLink = screen.getByRole('link', { name: /態\(能動・受動\)/ })
    expect(voiceLink).toHaveTextContent('B')
    const backLink = screen.getByRole('link', { name: /ホームに戻る/ })
    expect(backLink).toHaveTextContent('C')

    fireEvent.keyDown(window, { key: 'b' })
    expect(await screen.findByText('drill screen')).toBeInTheDocument()
  })

  it('shows the accuracy rate for categories with attempt data', async () => {
    vi.mocked(getGrammarCategories).mockResolvedValue([{ id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 }])
    vi.mocked(getGrammarCategoryStats).mockResolvedValue([
      {
        categoryId: 1,
        categoryCode: 'tense',
        categoryName: '時制',
        totalAttempts: 10,
        correctAttempts: 9,
        accuracyRate: 0.9,
        lastAttemptedAt: '2026-08-12T00:00:00Z',
      },
    ])

    renderGrammarCategories()

    const tenseLink = await screen.findByRole('link', { name: /時制/ })
    expect(tenseLink).toHaveTextContent('90%')
  })

  it('shows a placeholder instead of a rate for categories with no attempt data yet', async () => {
    vi.mocked(getGrammarCategories).mockResolvedValue([{ id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 }])
    // getGrammarCategoryStatsは未挑戦カテゴリの行を返さないビュー(weakPoints.ts参照)なので、空配列のままでよい

    renderGrammarCategories()

    const tenseLink = await screen.findByRole('link', { name: /時制/ })
    expect(tenseLink).toHaveTextContent('—')
    expect(tenseLink).not.toHaveTextContent('%')
  })
})
