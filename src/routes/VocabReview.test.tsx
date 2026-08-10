import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import VocabReview from './VocabReview'
import type { VocabCard } from '../lib/queries/vocab'

vi.mock('../lib/queries/vocab', () => ({
  getDueVocabCards: vi.fn(),
  getVocabTagByCode: vi.fn(),
  submitVocabReview: vi.fn(),
}))
vi.mock('../lib/queries/tutor', () => ({
  askTutor: vi.fn(),
}))

const { getDueVocabCards, getVocabTagByCode, submitVocabReview } = await import('../lib/queries/vocab')

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderVocabReview(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/', element: <VocabReview />, loader: () => ({ session: fakeSession }) },
      { path: '/vocab/review/:tagCode', element: <VocabReview />, loader: () => ({ session: fakeSession }) },
    ],
    { initialEntries: [initialPath] },
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const sampleCard: VocabCard = {
  vocabWordId: 'word-1',
  word: 'negotiate',
  partOfSpeech: 'verb',
  meaningJa: '交渉する',
  exampleSentenceEn: 'We need to negotiate.',
  exampleSentenceJa: '交渉する必要がある。',
  etymologyNote: 'neg-(否定)+otium(暇)→「暇ではない」',
  progress: null,
}

beforeEach(() => {
  vi.mocked(getDueVocabCards).mockReset()
  vi.mocked(getVocabTagByCode).mockReset().mockResolvedValue(null)
  vi.mocked(submitVocabReview).mockReset()
})

describe('VocabReview', () => {
  it('shows an empty-state message when there are no due cards', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([])
    renderVocabReview()
    expect(await screen.findByText('本日レビューする語彙カードはありません。')).toBeInTheDocument()
  })

  it('shows the word first, then reveals the meaning and rating buttons on click', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    renderVocabReview()

    expect(await screen.findByText('negotiate')).toBeInTheDocument()
    expect(screen.queryByText('交渉する')).not.toBeInTheDocument()
    expect(screen.queryByText(sampleCard.etymologyNote!)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '答えを見る' }))

    expect(await screen.findByText('交渉する')).toBeInTheDocument()
    expect(screen.getByText(sampleCard.etymologyNote!)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /もう一度/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /簡単/ })).toBeInTheDocument()
  })

  it('submits the chosen rating and advances to the session-complete screen', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    vi.mocked(submitVocabReview).mockResolvedValue({
      state: 'learning',
      dueAt: new Date().toISOString(),
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      lastReviewAt: new Date().toISOString(),
    })

    renderVocabReview()
    fireEvent.click(await screen.findByRole('button', { name: '答えを見る' }))
    fireEvent.click(await screen.findByRole('button', { name: /普通/ }))

    await waitFor(() => expect(submitVocabReview).toHaveBeenCalledTimes(1))
    expect(vi.mocked(submitVocabReview).mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      vocabWordId: 'word-1',
      rating: 'good',
    })
    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
  })

  it('passes the tagCode route param (vocab_tags.code) through to getDueVocabCards and shows the resolved tag name', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    vi.mocked(getVocabTagByCode).mockResolvedValue({ id: 1, name: 'ビジネス' })
    renderVocabReview('/vocab/review/business')

    expect(await screen.findByText('negotiate')).toBeInTheDocument()
    expect(await screen.findByText('タグ: ビジネス')).toBeInTheDocument()
    expect(getDueVocabCards).toHaveBeenCalledWith('user-1', 20, 'business')
    expect(getVocabTagByCode).toHaveBeenCalledWith('business')
  })

  it('falls back to showing the raw tagCode while the tag name is still resolving', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    vi.mocked(getVocabTagByCode).mockReturnValue(new Promise(() => {})) // 解決しないままにする
    renderVocabReview('/vocab/review/business')

    expect(await screen.findByText('タグ: business')).toBeInTheDocument()
  })

  it('shows a tag-specific empty state (using the resolved tag name) and links back to the weak-points dashboard', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([])
    vi.mocked(getVocabTagByCode).mockResolvedValue({ id: 1, name: 'ビジネス' })
    renderVocabReview('/vocab/review/business')

    expect(await screen.findByText('「ビジネス」の対象カードはありません。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '弱点分析ダッシュボードに戻る' })).toHaveAttribute(
      'href',
      '/weak-points',
    )
  })

  it('shows the keyboard-shortcut hint', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    renderVocabReview()
    expect(await screen.findByText('1〜4: 評価（答えを見た後）')).toBeInTheDocument()
  })

  it('rates the card via the 1-4 keys once revealed (e.g. "3" -> good)', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    vi.mocked(submitVocabReview).mockResolvedValue({
      state: 'learning',
      dueAt: new Date().toISOString(),
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      lastReviewAt: new Date().toISOString(),
    })

    renderVocabReview()
    fireEvent.click(await screen.findByRole('button', { name: '答えを見る' }))
    expect(await screen.findByText('交渉する')).toBeInTheDocument()

    // RATING_ORDER = ['again', 'hard', 'good', 'easy'] -> index 2 ("3") is "good"
    fireEvent.keyDown(window, { key: '3' })

    await waitFor(() => expect(submitVocabReview).toHaveBeenCalledTimes(1))
    expect(vi.mocked(submitVocabReview).mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      vocabWordId: 'word-1',
      rating: 'good',
    })
    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
  })

  it('does not react to the 1-4 keys before the answer is revealed', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    renderVocabReview()

    expect(await screen.findByText('negotiate')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })

    expect(submitVocabReview).not.toHaveBeenCalled()
    // 答えを見る前なので画面は変わっていない
    expect(screen.queryByText('交渉する')).not.toBeInTheDocument()
  })

  it('ignores the 1-4 keys while a rating mutation is still pending', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    vi.mocked(submitVocabReview).mockReturnValue(new Promise(() => {})) // 解決しないままにする

    renderVocabReview()
    fireEvent.click(await screen.findByRole('button', { name: '答えを見る' }))
    expect(await screen.findByText('交渉する')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '1' })
    await waitFor(() => expect(submitVocabReview).toHaveBeenCalledTimes(1))

    // ミューテーションが未解決(pending)のまま2回目のキー入力をしても追加送信されない
    fireEvent.keyDown(window, { key: '2' })
    expect(submitVocabReview).toHaveBeenCalledTimes(1)
  })
})
