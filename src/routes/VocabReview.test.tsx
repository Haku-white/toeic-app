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
  getVocabProgressStats: vi.fn(),
  applySessionTransitions: vi.fn(),
}))
vi.mock('../lib/queries/tutor', () => ({
  askTutor: vi.fn(),
}))

const { getDueVocabCards, getVocabTagByCode, submitVocabReview, getVocabProgressStats, applySessionTransitions } =
  await import('../lib/queries/vocab')

const sampleProgressStats = {
  totalWords: 100,
  newCount: 40,
  learningCount: 10,
  reviewCount: 45,
  relearningCount: 5,
  dueCount: 8,
  averageStability: 12.34,
}

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderVocabReview(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/', element: <VocabReview />, loader: () => ({ session: fakeSession }) },
      { path: '/vocab/review/:tagCode', element: <VocabReview />, loader: () => ({ session: fakeSession }) },
      // セッション完了画面からのEnterキー遷移先(タグ絞り込み時は/weak-points)確認用のスタブ
      { path: '/weak-points', element: <div>弱点分析ダッシュボード画面</div> },
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
  additionalExplanation: '"negotiate"と"negate"(否定する)は綴りが似ているため混同しやすい単語です。',
  progress: null,
}

beforeEach(() => {
  vi.mocked(getDueVocabCards).mockReset()
  vi.mocked(getVocabTagByCode).mockReset().mockResolvedValue(null)
  vi.mocked(submitVocabReview).mockReset()
  vi.mocked(getVocabProgressStats).mockReset().mockResolvedValue(sampleProgressStats)
  vi.mocked(applySessionTransitions).mockReset().mockReturnValue(sampleProgressStats)
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

  it('shows the "よくある間違いのポイント" box when the card has an additionalExplanation (11章)', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    renderVocabReview()

    fireEvent.click(await screen.findByRole('button', { name: '答えを見る' }))

    expect(await screen.findByText('よくある間違いのポイント')).toBeInTheDocument()
    expect(screen.getByText(sampleCard.additionalExplanation!)).toBeInTheDocument()
  })

  it('does not show the "よくある間違いのポイント" box when additionalExplanation is null', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([{ ...sampleCard, additionalExplanation: null }])
    renderVocabReview()

    fireEvent.click(await screen.findByRole('button', { name: '答えを見る' }))

    expect(await screen.findByText('交渉する')).toBeInTheDocument()
    expect(screen.queryByText('よくある間違いのポイント')).not.toBeInTheDocument()
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

  it('shows a state-appropriate keyboard-shortcut hint (Enter to reveal, then 1-4 to rate)', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    renderVocabReview()

    expect(await screen.findByText('Enter: 答えを見る')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '答えを見る' }))
    expect(await screen.findByText('1〜4: 評価')).toBeInTheDocument()
  })

  it('changes the keyboard-shortcut hint while asking the tutor a question (26章)', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    renderVocabReview()

    fireEvent.click(await screen.findByRole('button', { name: '答えを見る' }))
    expect(await screen.findByText('1〜4: 評価')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
    const textarea = screen.getByPlaceholderText(/この問題について質問する/)
    fireEvent.focus(textarea)

    expect(screen.getByText('Enter: 質問を送信 / Shift+Enter: 改行')).toBeInTheDocument()
    expect(screen.queryByText('1〜4: 評価')).not.toBeInTheDocument()

    fireEvent.blur(textarea)
    expect(await screen.findByText('1〜4: 評価')).toBeInTheDocument()
  })

  it('reveals the answer via Enter (25章: keyboard-only flow to the first card)', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    renderVocabReview()

    expect(await screen.findByText('negotiate')).toBeInTheDocument()
    expect(screen.queryByText('交渉する')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByText('交渉する')).toBeInTheDocument()
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

  it('navigates back via Enter on the session-complete screen (25章: keyboard-only flow to the end)', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    vi.mocked(getVocabTagByCode).mockResolvedValue({ id: 1, name: 'ビジネス' })
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

    renderVocabReview('/vocab/review/business')
    expect(await screen.findByText('negotiate')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' }) // 答えを見る
    expect(await screen.findByText('交渉する')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '3' }) // 評価(good) -> 自動で次へ(セッション完了)
    await waitFor(() => expect(submitVocabReview).toHaveBeenCalledTimes(1))

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    expect(screen.getByText('Enter: 弱点分析ダッシュボードに戻る')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByText('弱点分析ダッシュボード画面')).toBeInTheDocument()
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

  it('shows the compact SRS progress hub (31章) on the session-complete screen, fed by the recorded state transition', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    const afterReview = {
      state: 'learning' as const,
      dueAt: new Date().toISOString(),
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      lastReviewAt: new Date().toISOString(),
    }
    vi.mocked(submitVocabReview).mockResolvedValue(afterReview)

    renderVocabReview()
    fireEvent.click(await screen.findByRole('button', { name: '答えを見る' }))
    fireEvent.click(await screen.findByRole('button', { name: /普通/ }))

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    // sampleCard.progressはnull(初出の単語)のため、beforeはnullとして記録される
    expect(applySessionTransitions).toHaveBeenCalledWith(sampleProgressStats, [{ before: null, after: afterReview }])
    expect(screen.getByText('SESSION IMPACT')).toBeInTheDocument()
  })

  it('omits the progress hub when the baseline SRS stats query fails', async () => {
    vi.mocked(getDueVocabCards).mockResolvedValue([sampleCard])
    vi.mocked(getVocabProgressStats).mockReset().mockRejectedValue(new Error('boom'))
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

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    expect(screen.queryByText('SESSION IMPACT')).not.toBeInTheDocument()
  })
})
