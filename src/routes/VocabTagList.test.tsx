import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import VocabTagList from './VocabTagList'

vi.mock('../lib/queries/vocab', () => ({
  getVocabTags: vi.fn(),
}))

const { getVocabTags } = await import('../lib/queries/vocab')

function renderVocabTagList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/vocab/tags', element: <VocabTagList /> },
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
})
