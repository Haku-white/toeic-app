import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import VocabTagList from './VocabTagList'

vi.mock('../lib/queries/vocab', () => ({
  getVocabTags: vi.fn(),
  getVocabProgressStats: vi.fn(),
}))

const { getVocabTags, getVocabProgressStats } = await import('../lib/queries/vocab')

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderVocabTagList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/vocab/tags', element: <VocabTagList />, loader: () => ({ session: fakeSession }) },
      { path: '/vocab/review/:tagCode', element: <div>review screen</div> },
    ],
    { initialEntries: ['/vocab/tags'] },
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getVocabTags).mockReset()
  vi.mocked(getVocabProgressStats).mockReset().mockResolvedValue({
    totalWords: 100,
    newCount: 40,
    learningCount: 10,
    reviewCount: 45,
    relearningCount: 5,
    dueCount: 8,
    averageStability: 12.34,
  })
})

describe('VocabTagList', () => {
  it('lists all tags as links to their review route', async () => {
    vi.mocked(getVocabTags).mockResolvedValue([
      { id: 1, code: 'business', name: 'ビジネス' },
      { id: 2, code: 'part7', name: 'Part7頻出' },
    ])

    renderVocabTagList()

    const businessLink = await screen.findByRole('link', { name: /ビジネス/ })
    expect(businessLink).toHaveAttribute('href', '/vocab/review/business')

    const part7Link = screen.getByRole('link', { name: /Part7頻出/ })
    expect(part7Link).toHaveAttribute('href', '/vocab/review/part7')
  })

  it('shows an empty-state message when there are no tags yet', async () => {
    vi.mocked(getVocabTags).mockResolvedValue([])
    renderVocabTagList()
    expect(await screen.findByText('まだ語彙タグがありません。')).toBeInTheDocument()
  })

  it('shows an error message when the query fails', async () => {
    vi.mocked(getVocabTags).mockRejectedValue(new Error('network down'))
    renderVocabTagList()
    expect(await screen.findByText(/タグの取得に失敗しました/)).toBeInTheDocument()
  })

  it('assigns sequential A, B... shortcut keys to tags then the back link, and navigates on keypress', async () => {
    vi.mocked(getVocabTags).mockResolvedValue([
      { id: 1, code: 'business', name: 'ビジネス' },
      { id: 2, code: 'part7', name: 'Part7頻出' },
    ])

    renderVocabTagList()

    const businessLink = await screen.findByRole('link', { name: /ビジネス/ })
    expect(businessLink).toHaveTextContent('A')
    const part7Link = screen.getByRole('link', { name: /Part7頻出/ })
    expect(part7Link).toHaveTextContent('B')
    const backLink = screen.getByRole('link', { name: /ホームに戻る/ })
    expect(backLink).toHaveTextContent('C')

    fireEvent.keyDown(window, { key: 'b' })
    expect(await screen.findByText('review screen')).toBeInTheDocument()
  })

  it('still assigns a shortcut key to the back link in the empty-tags state', async () => {
    vi.mocked(getVocabTags).mockResolvedValue([])
    renderVocabTagList()

    const backLink = await screen.findByRole('link', { name: /ホームに戻る/ })
    expect(backLink).toHaveTextContent('A')
  })

  it('renders the full SRS progress hub (31章) above the tag list', async () => {
    vi.mocked(getVocabTags).mockResolvedValue([])
    renderVocabTagList()

    expect(await screen.findByText('SRS PROGRESS')).toBeInTheDocument()
    expect(getVocabProgressStats).toHaveBeenCalledWith('user-1')
    expect(screen.getByText('8件')).toBeInTheDocument()
  })

  it('still shows the tag list when the progress-stats query fails', async () => {
    vi.mocked(getVocabTags).mockResolvedValue([{ id: 1, code: 'business', name: 'ビジネス' }])
    vi.mocked(getVocabProgressStats).mockRejectedValue(new Error('boom'))
    renderVocabTagList()

    expect(await screen.findByRole('link', { name: /ビジネス/ })).toBeInTheDocument()
    expect(screen.queryByText('SRS PROGRESS')).not.toBeInTheDocument()
  })
})
