import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import MixedDrill from './MixedDrill'
import type { MixedQuestion } from '../lib/queries/mixedDrill'
import { useMixedDrillSessionStore } from '../stores/mixedDrillSessionStore'

vi.mock('../lib/queries/mixedDrill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries/mixedDrill')>()
  return {
    ...actual,
    getMixedDrillQuestions: vi.fn(),
  }
})
vi.mock('../lib/queries/grammar', () => ({
  submitGrammarAttempt: vi.fn(),
}))
vi.mock('../lib/queries/vocab', () => ({
  submitVocabReview: vi.fn(),
}))
vi.mock('../lib/queries/tutor', () => ({
  askTutor: vi.fn(),
}))

const { getMixedDrillQuestions } = await import('../lib/queries/mixedDrill')
const { submitGrammarAttempt } = await import('../lib/queries/grammar')
const { submitVocabReview } = await import('../lib/queries/vocab')
const { askTutor } = await import('../lib/queries/tutor')

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderMixedDrill() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/mixed-drill',
        element: <MixedDrill />,
        loader: () => ({ session: fakeSession }),
      },
      // セッション完了画面からのEnterキー遷移先(/)確認用のスタブ
      { path: '/', element: <div>ホーム画面</div> },
    ],
    { initialEntries: ['/mixed-drill'] },
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const questions: MixedQuestion[] = [
  {
    id: 'grammar-q1',
    kind: 'grammar',
    questionText: 'The company ___ its report by Friday.',
    choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
    correctIndex: 0,
    explanation: '未来完了形を使う。',
    additionalExplanation: null,
    grammarQuestionId: 'q1',
  },
  {
    id: 'vocab-v1',
    kind: 'vocab',
    questionText: '「negotiate」の意味として最も適切なものを選んでください。',
    choices: ['交渉する', '払い戻す', '子会社', '在庫'],
    correctIndex: 0,
    explanation: 'neg-note',
    additionalExplanation: '"negotiate"と"negate"は綴りが似ているため混同しやすい単語です。',
    vocabWordId: 'v1',
    vocabProgress: null,
  },
]

beforeEach(() => {
  vi.mocked(getMixedDrillQuestions).mockReset()
  vi.mocked(submitGrammarAttempt).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(submitVocabReview).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(askTutor).mockReset()
  useMixedDrillSessionStore.getState().resetSession()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MixedDrill', () => {
  it('shows the empty-state message when there are no questions', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue([])
    renderMixedDrill()
    expect(await screen.findByText('出題できる問題がまだありません。')).toBeInTheDocument()
  })

  it('submits a grammar attempt via submitGrammarAttempt when a grammar question is answered', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /submits/ }))

    expect(await screen.findByText('未来完了形を使う。')).toBeInTheDocument()
    await waitFor(() => expect(submitGrammarAttempt).toHaveBeenCalledTimes(1))
    expect(vi.mocked(submitGrammarAttempt).mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      questionId: 'q1',
      selectedIndex: 1,
      isCorrect: false,
    })
    expect(submitVocabReview).not.toHaveBeenCalled()
  })

  it('submits a vocab review with rating "hard" (not "good") when the 4-choice answer is correct', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue([questions[1]])
    renderMixedDrill()

    expect(await screen.findByText('「negotiate」の意味として最も適切なものを選んでください。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /交渉する/ }))

    await waitFor(() => expect(submitVocabReview).toHaveBeenCalledTimes(1))
    expect(vi.mocked(submitVocabReview).mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      vocabWordId: 'v1',
      rating: 'hard',
    })
  })

  it('shows the "よくある間違いのポイント" box when the question has an additionalExplanation (11章)', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue([questions[1]])
    renderMixedDrill()

    expect(await screen.findByText('「negotiate」の意味として最も適切なものを選んでください。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /交渉する/ }))

    expect(await screen.findByText('よくある間違いのポイント')).toBeInTheDocument()
    expect(
      screen.getByText('"negotiate"と"negate"は綴りが似ているため混同しやすい単語です。'),
    ).toBeInTheDocument()
  })

  it('does not show the "よくある間違いのポイント" box when additionalExplanation is null', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue([questions[0]])
    renderMixedDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /will have submitted/ }))

    expect(await screen.findByText('未来完了形を使う。')).toBeInTheDocument()
    expect(screen.queryByText('よくある間違いのポイント')).not.toBeInTheDocument()
  })

  it('submits a vocab review with rating "again" when the 4-choice answer is incorrect', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue([questions[1]])
    renderMixedDrill()

    fireEvent.click(await screen.findByRole('button', { name: /払い戻す/ }))

    await waitFor(() => expect(submitVocabReview).toHaveBeenCalledTimes(1))
    expect(vi.mocked(submitVocabReview).mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      vocabWordId: 'v1',
      rating: 'again',
    })
  })

  it('progresses through all questions and shows grammar/vocab accuracy separately on completion', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    fireEvent.click(await screen.findByRole('button', { name: /will have submitted/ }))
    fireEvent.click(await screen.findByRole('button', { name: '次の問題へ' }))

    expect(await screen.findByText('「negotiate」の意味として最も適切なものを選んでください。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /交渉する/ }))
    fireEvent.click(await screen.findByRole('button', { name: '結果を見る' }))

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    // 総合の正答率(2問中2問=100%)。%記号をfont-mono用の<span>で分けているため、divのtextContentで照合する
    expect(
      screen.getByText((_content, element) => element?.tagName === 'DIV' && element.textContent === '100%'),
    ).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    // カテゴリ別内訳(文法1/1・語彙1/1)は行ごとにラベルと正答率をscopeして確認する
    const grammarRow = screen.getByText('文法').closest('div')!
    expect(within(grammarRow).getByText('100%')).toBeInTheDocument()
    const vocabRow = screen.getByText('語彙').closest('div')!
    expect(within(vocabRow).getByText('100%')).toBeInTheDocument()
  })

  it('measures elapsed time from session start to completion and shows it in the summary (28章)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    fireEvent.click(await screen.findByRole('button', { name: /will have submitted/ }))
    fireEvent.click(await screen.findByRole('button', { name: '次の問題へ' }))
    expect(await screen.findByText('「negotiate」の意味として最も適切なものを選んでください。')).toBeInTheDocument()

    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 8))
    fireEvent.click(screen.getByRole('button', { name: /交渉する/ }))
    fireEvent.click(await screen.findByRole('button', { name: '結果を見る' }))

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    expect(screen.getByText('0:08')).toBeInTheDocument()
  })

  it('shows the keyboard-shortcut hint', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()
    expect(await screen.findByText('1〜4: 選択 / Enter: 次へ')).toBeInTheDocument()
  })

  it('changes the keyboard-shortcut hint while asking the tutor a question (26章)', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    fireEvent.click(await screen.findByRole('button', { name: /will have submitted/ }))
    expect(await screen.findByText('1〜4: 選択 / Enter: 次へ')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
    const textarea = screen.getByPlaceholderText(/この問題について質問する/)
    fireEvent.focus(textarea)

    expect(screen.getByText('Enter: 質問を送信 / Shift+Enter: 改行 / Ctrl+Enter: 次へ')).toBeInTheDocument()
    expect(screen.queryByText('1〜4: 選択 / Enter: 次へ')).not.toBeInTheDocument()

    fireEvent.blur(textarea)
    expect(await screen.findByText('1〜4: 選択 / Enter: 次へ')).toBeInTheDocument()
  })

  it('advances to the next question via Ctrl+Enter while the tutor textarea is focused (26章)', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    fireEvent.click(await screen.findByRole('button', { name: /will have submitted/ }))
    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
    const textarea = screen.getByPlaceholderText(/この問題について質問する/)
    fireEvent.change(textarea, { target: { value: 'なぜ現在完了ではダメですか?' } })

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(await screen.findByText('「negotiate」の意味として最も適切なものを選んでください。')).toBeInTheDocument()
    expect(askTutor).not.toHaveBeenCalled()
  })

  it('selects a choice via the 1-4 keys and highlights it', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()

    // '2' (index 1, "submits") を入力する
    fireEvent.keyDown(window, { key: '2' })

    expect(await screen.findByText('未来完了形を使う。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /will have submitted/ })).toHaveClass('border-correct-600')
    expect(screen.getByRole('button', { name: /^2 submits$/ })).toHaveClass('border-incorrect-600')
    await waitFor(() => expect(submitGrammarAttempt).toHaveBeenCalledTimes(1))
  })

  it('does nothing when Enter is pressed before an answer is selected', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.getByText('The company ___ its report by Friday.')).toBeInTheDocument()
    expect(screen.queryByText('未来完了形を使う。')).not.toBeInTheDocument()
    expect(submitGrammarAttempt).not.toHaveBeenCalled()
  })

  it('advances to the next question via Enter after answering (keyboard-only flow)', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    expect(await screen.findByText('未来完了形を使う。')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByText('「negotiate」の意味として最も適切なものを選んでください。')).toBeInTheDocument()
  })

  it('navigates home via Enter on the session-complete screen (25章: keyboard-only flow to the end)', async () => {
    vi.mocked(getMixedDrillQuestions).mockResolvedValue(questions)
    renderMixedDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    await waitFor(() => expect(submitGrammarAttempt).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByText('「negotiate」の意味として最も適切なものを選んでください。')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    await waitFor(() => expect(submitVocabReview).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    expect(screen.getByText('Enter: ホームに戻る')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByText('ホーム画面')).toBeInTheDocument()
  })
})
