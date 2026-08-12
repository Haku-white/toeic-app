import { fireEvent, render, screen } from '@testing-library/react'
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
    [
      { path: '/weak-points', element: <WeakPoints />, loader: () => ({ session: fakeSession }) },
      { path: '/grammar/:categoryCode', element: <div>grammar drill screen</div> },
      { path: '/vocab/review/:tagCode', element: <div>vocab review screen</div> },
      { path: '/', element: <div>home screen</div> },
    ],
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
    expect(weakGrammarLink).toHaveTextContent('33%')
    expect(weakGrammarLink.querySelector('svg circle:nth-of-type(2)')).toHaveClass('stroke-incorrect-500')

    const strongGrammarLink = screen.getByRole('link', { name: /時制/ })
    expect(strongGrammarLink).toHaveTextContent('100%')
    expect(strongGrammarLink.querySelector('svg circle:nth-of-type(2)')).toHaveClass('stroke-correct-500')

    const weakVocabLink = screen.getByRole('link', { name: /Part7頻出/ })
    expect(weakVocabLink).toHaveAttribute('href', '/vocab/review/part7')
    expect(weakVocabLink.querySelector('svg circle:nth-of-type(2)')).toHaveClass('stroke-incorrect-500')
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

  it('assigns one continuous A, B... sequence across the grammar section, the vocab section, then the back link', async () => {
    vi.mocked(getGrammarCategoryStats).mockResolvedValue([
      {
        categoryId: 1,
        categoryCode: 'tense',
        categoryName: '時制',
        totalAttempts: 3,
        correctAttempts: 3,
        accuracyRate: 1,
        lastAttemptedAt: null,
      },
      {
        categoryId: 3,
        categoryCode: 'subjunctive',
        categoryName: '仮定法',
        totalAttempts: 3,
        correctAttempts: 1,
        accuracyRate: 0.333,
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

    // 文法(A, B) -> 語彙(C, 続き) -> 戻るリンク(D)、の1連番シーケンスであること
    const tenseLink = await screen.findByRole('link', { name: /時制/ })
    expect(tenseLink).toHaveTextContent('A')
    const subjunctiveLink = screen.getByRole('link', { name: /仮定法/ })
    expect(subjunctiveLink).toHaveTextContent('B')
    const part7Link = screen.getByRole('link', { name: /Part7頻出/ })
    expect(part7Link).toHaveTextContent('C')
    const backLink = screen.getByRole('link', { name: /ホームに戻る/ })
    expect(backLink).toHaveTextContent('D')

    // 語彙セクション側のキー("C")を押すとその項目へ遷移する(文法セクションのキーと衝突しないこと)
    fireEvent.keyDown(window, { key: 'c' })
    expect(await screen.findByText('vocab review screen')).toBeInTheDocument()
  })
})
