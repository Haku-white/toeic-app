import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AskTutorPanel from './AskTutorPanel'

vi.mock('../lib/queries/tutor', () => ({
  askTutor: vi.fn(),
}))

const { askTutor } = await import('../lib/queries/tutor')

function renderPanel(overrides: { choices?: string[]; onFocusChange?: (isFocused: boolean) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AskTutorPanel
        questionText="The company ___ its report by Friday."
        choices={'choices' in overrides ? overrides.choices : ['will have submitted', 'submits']}
        correctAnswer="will have submitted"
        explanation="未来完了形を使う。"
        onFocusChange={overrides.onFocusChange}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(askTutor).mockReset()
})

describe('AskTutorPanel', () => {
  it('shows a closed button and opens the question form when clicked', () => {
    renderPanel()
    expect(screen.queryByPlaceholderText(/この問題について質問する/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))

    expect(screen.getByPlaceholderText(/この問題について質問する/)).toBeInTheDocument()
  })

  it('submits the question with the question context and shows the answer', async () => {
    vi.mocked(askTutor).mockResolvedValue({ status: 'ok', answer: '現在完了は継続を表すためです。' })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
    fireEvent.change(screen.getByPlaceholderText(/この問題について質問する/), {
      target: { value: 'なぜ現在完了ではダメなのですか?' },
    })
    fireEvent.click(screen.getByRole('button', { name: '質問する' }))

    expect(await screen.findByText('現在完了は継続を表すためです。')).toBeInTheDocument()
    expect(vi.mocked(askTutor).mock.calls[0][0]).toEqual({
      questionText: 'The company ___ its report by Friday.',
      choices: ['will have submitted', 'submits'],
      correctAnswer: 'will have submitted',
      explanation: '未来完了形を使う。',
      userQuestion: 'なぜ現在完了ではダメなのですか?',
    })
  })

  it('shows the rate-limited message returned by the Edge Function', async () => {
    vi.mocked(askTutor).mockResolvedValue({ status: 'rate_limited', message: '本日の質問回数上限に達しました。' })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
    fireEvent.change(screen.getByPlaceholderText(/この問題について質問する/), { target: { value: '質問' } })
    fireEvent.click(screen.getByRole('button', { name: '質問する' }))

    expect(await screen.findByText('本日の質問回数上限に達しました。')).toBeInTheDocument()
  })

  it('disables the submit button and does not call askTutor while the question is empty', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))

    expect(screen.getByRole('button', { name: '質問する' })).toBeDisabled()
    expect(askTutor).not.toHaveBeenCalled()
  })

  describe('Enterキーの挙動（25章: 親画面のグローバルショートカットとの競合対策）', () => {
    it('submits the question via Enter (without Shift)', async () => {
      vi.mocked(askTutor).mockResolvedValue({ status: 'ok', answer: '回答です。' })
      renderPanel()

      fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
      const textarea = screen.getByPlaceholderText(/この問題について質問する/)
      fireEvent.change(textarea, { target: { value: '質問文' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(await screen.findByText('回答です。')).toBeInTheDocument()
      expect(askTutor).toHaveBeenCalledTimes(1)
    })

    it('does not submit on Shift+Enter (allows a newline instead)', () => {
      renderPanel()

      fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
      const textarea = screen.getByPlaceholderText(/この問題について質問する/)
      fireEvent.change(textarea, { target: { value: '質問文' } })
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

      expect(askTutor).not.toHaveBeenCalled()
    })

    it('does not let any keydown inside the panel (Enter, digits, etc.) propagate to a parent window listener', () => {
      const parentListener = vi.fn()
      window.addEventListener('keydown', parentListener)
      try {
        renderPanel()
        fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
        const textarea = screen.getByPlaceholderText(/この問題について質問する/)

        // Enter・数字キー(GrammarDrill/MixedDrillの選択キー・VocabReviewの評価キーと同じ値)
        // のいずれも、テキストエリアにフォーカスがある間は親のwindowリスナーに届かないこと。
        fireEvent.keyDown(textarea, { key: 'Enter' })
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
        fireEvent.keyDown(textarea, { key: '1' })
        fireEvent.keyDown(textarea, { key: '2' })

        expect(parentListener).not.toHaveBeenCalled()
      } finally {
        window.removeEventListener('keydown', parentListener)
      }
    })

    it('does not let a keydown on the closed "もっと詳しく聞く" button propagate to a parent window listener', () => {
      const parentListener = vi.fn()
      window.addEventListener('keydown', parentListener)
      try {
        renderPanel()
        const openButton = screen.getByRole('button', { name: /もっと詳しく聞く/ })
        fireEvent.keyDown(openButton, { key: 'Enter' })

        expect(parentListener).not.toHaveBeenCalled()
      } finally {
        window.removeEventListener('keydown', parentListener)
      }
    })
  })

  describe('"?"ショートカット（26章: マウスを使わずパネルを開けるようにする）', () => {
    it('opens the panel via the "?" key while closed', () => {
      renderPanel()
      expect(screen.queryByPlaceholderText(/この問題について質問する/)).not.toBeInTheDocument()

      fireEvent.keyDown(window, { key: '?' })

      expect(screen.getByPlaceholderText(/この問題について質問する/)).toBeInTheDocument()
    })

    it('does not treat "?" as a shortcut once the panel is already open (it should type normally)', () => {
      renderPanel()
      fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
      const textarea = screen.getByPlaceholderText(/この問題について質問する/)

      fireEvent.change(textarea, { target: { value: '？' } })
      fireEvent.keyDown(textarea, { key: '?' })

      expect(askTutor).not.toHaveBeenCalled()
    })
  })

  describe('定型質問のスニペットボタン（26章）', () => {
    it('fills the textarea when a snippet is clicked', () => {
      renderPanel()
      fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))

      fireEvent.click(screen.getByRole('button', { name: 'なぜこの答えが正しいのですか?' }))

      expect(screen.getByPlaceholderText(/この問題について質問する/)).toHaveValue('なぜこの答えが正しいのですか?')
    })

    it('shows a choice-specific snippet when choices are provided', () => {
      renderPanel()
      fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))

      expect(screen.getByRole('button', { name: '他の選択肢ではなぜダメなのですか?' })).toBeInTheDocument()
    })

    it('omits the choice-specific snippet when there are no choices (e.g. VocabReview)', () => {
      renderPanel({ choices: undefined })
      fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))

      expect(screen.queryByRole('button', { name: '他の選択肢ではなぜダメなのですか?' })).not.toBeInTheDocument()
    })
  })

  describe('onFocusChange（26章: 質問入力中は親画面のショートカットヒント表示を切り替える）', () => {
    it('reports focus and blur of the textarea', () => {
      const onFocusChange = vi.fn()
      renderPanel({ onFocusChange })
      fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
      const textarea = screen.getByPlaceholderText(/この問題について質問する/)

      fireEvent.focus(textarea)
      expect(onFocusChange).toHaveBeenLastCalledWith(true)

      fireEvent.blur(textarea)
      expect(onFocusChange).toHaveBeenLastCalledWith(false)
    })
  })
})
