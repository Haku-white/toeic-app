import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import GrammarDrill from './GrammarDrill'
import type { GrammarDrillData } from '../lib/queries/grammar'
import { useGrammarSessionStore } from '../stores/grammarSessionStore'

vi.mock('../lib/queries/grammar', () => ({
  getGrammarDrillData: vi.fn(),
  submitGrammarAttempt: vi.fn(),
}))
vi.mock('../lib/queries/tutor', () => ({
  askTutor: vi.fn(),
}))

const { getGrammarDrillData, submitGrammarAttempt } = await import('../lib/queries/grammar')

const fakeSession = { user: { id: 'user-1', email: 'test@example.com' } } as unknown as Session

function renderGrammarDrill() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/grammar/:categoryCode',
        element: <GrammarDrill />,
        loader: () => ({ session: fakeSession }),
      },
      // セッション完了画面からのEnterキー遷移先(/grammar)確認用のスタブ
      { path: '/grammar', element: <div>文法カテゴリ</div> },
    ],
    { initialEntries: ['/grammar/tense'] },
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const drillData: GrammarDrillData = {
  category: { id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 },
  questions: [
    {
      id: 'q-1',
      categoryId: 1,
      questionText: 'The company ___ its report by Friday.',
      choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
      correctIndex: 0,
      explanation: '未来完了形を使う。',
      difficulty: 3,
    },
    {
      id: 'q-2',
      categoryId: 1,
      questionText: 'She ___ here since 2020.',
      choices: ['works', 'has worked', 'will work', 'working'],
      correctIndex: 1,
      explanation: '現在完了形を使う。',
      difficulty: 2,
    },
  ],
}

beforeEach(() => {
  vi.mocked(getGrammarDrillData).mockReset()
  vi.mocked(submitGrammarAttempt).mockReset().mockResolvedValue(undefined)
  // Zustandストアはモジュール単位のシングルトンでテスト間を跨いで残るため明示的にリセットする
  useGrammarSessionStore.getState().resetSession()
})

describe('GrammarDrill', () => {
  it('shows the empty-state message when the category has no questions', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue({
      category: { id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 },
      questions: [],
    })
    renderGrammarDrill()
    expect(await screen.findByText('このカテゴリにはまだ問題がありません。')).toBeInTheDocument()
  })

  it('highlights the correct answer and the wrong pick, then shows the explanation', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    expect(screen.queryByText('未来完了形を使う。')).not.toBeInTheDocument()

    // 誤答(submits, index 1)を選ぶ
    fireEvent.click(screen.getByRole('button', { name: /submits/ }))

    expect(await screen.findByText('未来完了形を使う。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /will have submitted/ })).toHaveClass('border-correct-600')
    expect(screen.getByRole('button', { name: /^2 submits$/ })).toHaveClass('border-incorrect-600')

    expect(vi.mocked(submitGrammarAttempt).mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      questionId: 'q-1',
      selectedIndex: 1,
      isCorrect: false,
    })
  })

  it('does not change the answer after the question has already been answered', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    fireEvent.click(await screen.findByRole('button', { name: /submits/ }))
    await waitFor(() => expect(submitGrammarAttempt).toHaveBeenCalledTimes(1))

    // 回答済みのためボタンはdisabledになっており、クリックしても何も起きない
    fireEvent.click(screen.getByRole('button', { name: /^3 submitted$/ }))
    expect(submitGrammarAttempt).toHaveBeenCalledTimes(1)
  })

  it('progresses through all questions and shows the session-complete summary', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    fireEvent.click(await screen.findByRole('button', { name: /will have submitted/ }))
    fireEvent.click(await screen.findByRole('button', { name: '次の問題へ' }))

    expect(await screen.findByText('She ___ here since 2020.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /has worked/ }))
    fireEvent.click(await screen.findByRole('button', { name: '結果を見る' }))

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    expect(screen.getByText('2問中2問正解しました。')).toBeInTheDocument()
  })

  it('shows the keyboard-shortcut hint', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    expect(await screen.findByText('1〜4: 選択 / Enter: 次へ')).toBeInTheDocument()
  })

  it('changes the keyboard-shortcut hint while asking the tutor a question (26章)', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    fireEvent.click(await screen.findByRole('button', { name: /will have submitted/ }))
    expect(await screen.findByText('1〜4: 選択 / Enter: 次へ')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
    const textarea = screen.getByPlaceholderText(/この問題について質問する/)
    fireEvent.focus(textarea)

    expect(screen.getByText('Enter: 質問を送信 / Shift+Enter: 改行')).toBeInTheDocument()
    expect(screen.queryByText('1〜4: 選択 / Enter: 次へ')).not.toBeInTheDocument()

    fireEvent.blur(textarea)
    expect(await screen.findByText('1〜4: 選択 / Enter: 次へ')).toBeInTheDocument()
  })

  it('selects a choice via the 1-4 keys and highlights it', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()

    // '2' (index 1, "submits") を入力する
    fireEvent.keyDown(window, { key: '2' })

    expect(await screen.findByText('未来完了形を使う。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /will have submitted/ })).toHaveClass('border-correct-600')
    expect(screen.getByRole('button', { name: /^2 submits$/ })).toHaveClass('border-incorrect-600')
    await waitFor(() => expect(submitGrammarAttempt).toHaveBeenCalledTimes(1))
  })

  it('does nothing when Enter is pressed before an answer is selected', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })

    // 未回答のままなので設問は変わらず、解説も出ない
    expect(screen.getByText('The company ___ its report by Friday.')).toBeInTheDocument()
    expect(screen.queryByText('未来完了形を使う。')).not.toBeInTheDocument()
    expect(submitGrammarAttempt).not.toHaveBeenCalled()
  })

  it('advances to the next question via Enter after answering (keyboard-only flow)', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    expect(await screen.findByText('未来完了形を使う。')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByText('She ___ here since 2020.')).toBeInTheDocument()
  })

  it('does not select a choice when an unrelated key is pressed', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'x' })

    expect(screen.queryByText('未来完了形を使う。')).not.toBeInTheDocument()
    expect(submitGrammarAttempt).not.toHaveBeenCalled()
  })

  it('navigates back to the category list via Enter on the session-complete screen (25章: keyboard-only flow to the end)', async () => {
    vi.mocked(getGrammarDrillData).mockResolvedValue(drillData)
    renderGrammarDrill()

    expect(await screen.findByText('The company ___ its report by Friday.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    await waitFor(() => expect(submitGrammarAttempt).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByText('She ___ here since 2020.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '2' })
    await waitFor(() => expect(submitGrammarAttempt).toHaveBeenCalledTimes(2))
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(await screen.findByText('セッション完了')).toBeInTheDocument()
    expect(screen.getByText('Enter: カテゴリ一覧に戻る')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByText('文法カテゴリ')).toBeInTheDocument()
  })
})
