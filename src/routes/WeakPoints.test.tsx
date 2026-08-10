import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import WeakPoints from './WeakPoints'

vi.mock('../lib/queries/weakPoints', () => ({
  getGrammarCategoryStats: vi.fn(),
  getVocabTagStats: vi.fn(),
}))

const { getGrammarCategoryStats, getVocabTagStats } = await import('../lib/queries/weakPoints')

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderWeakPoints() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [{ path: '/weak-points', element: <WeakPoints />, loader: () => ({ session: fakeSession }) }],
    { initialEntries: ['/weak-points'] },
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getGrammarCategoryStats).mockReset()
  vi.mocked(getVocabTagStats).mockReset()
})

describe('WeakPoints', () => {
  it('shows both sections with accuracy percentages and warning color under 70%', async () => {
    vi.mocked(getGrammarCategoryStats).mockResolvedValue([
      {
        categoryId: 3,
        categoryCode: 'subjunctive',
        categoryName: '仮定法',
        totalAttempts: 3,
        correctAttempts: 1,
        accuracyRate: 0.333,
        lastAttemptedAt: null,
      },
      {
        categoryId: 1,
        categoryCode: 'tense',
        categoryName: '時制',
        totalAttempts: 3,
        correctAttempts: 3,
        accuracyRate: 1,
        lastAttemptedAt: null,
      },
    ])
    vi.mocked(getVocabTagStats).mockResolvedValue([
      {
        tagId: 3,
        tagCode: 'part7',
        tagName: 'Part7頻出',
        totalReviews: 12,
        correctReviews: 4,
        accuracyRate: 0.333,
        lastReviewedAt: null,
      },
    ])

    renderWeakPoints()

    const weakGrammarLink = await screen.findByRole('link', { name: /仮定法/ })
    expect(weakGrammarLink).toHaveAttribute('href', '/grammar/subjunctive')
    expect(weakGrammarLink).toHaveClass('border-incorrect-300')
    expect(weakGrammarLink).toHaveTextContent('33%')

    const strongGrammarLink = screen.getByRole('link', { name: /時制/ })
    expect(strongGrammarLink).not.toHaveClass('border-incorrect-300')
    expect(strongGrammarLink).toHaveTextContent('100%')

    const weakVocabLink = screen.getByRole('link', { name: /Part7頻出/ })
    expect(weakVocabLink).toHaveAttribute('href', '/vocab/review/part7')
    expect(weakVocabLink).toHaveClass('border-incorrect-300')
  })

  it('shows an empty-state message per section when there is no data yet', async () => {
    vi.mocked(getGrammarCategoryStats).mockResolvedValue([])
    vi.mocked(getVocabTagStats).mockResolvedValue([])

    renderWeakPoints()

    expect(await screen.findByText('まだ解答データがありません。')).toBeInTheDocument()
    expect(screen.getByText('まだレビューデータがありません。')).toBeInTheDocument()
  })

  it('shows an error message when a stats query fails', async () => {
    vi.mocked(getGrammarCategoryStats).mockRejectedValue(new Error('network down'))
    vi.mocked(getVocabTagStats).mockResolvedValue([])

    renderWeakPoints()

    expect(await screen.findByText(/統計の取得に失敗しました/)).toBeInTheDocument()
  })
})
