import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AskTutorPanel from './AskTutorPanel'

vi.mock('../lib/queries/tutor', () => ({
  askTutor: vi.fn(),
}))

const { askTutor } = await import('../lib/queries/tutor')

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AskTutorPanel
        questionText="The company ___ its report by Friday."
        choices={['will have submitted', 'submits']}
        correctAnswer="will have submitted"
        explanation="未来完了形を使う。"
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
    expect(screen.queryByPlaceholderText('この問題について質問する...')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'もっと詳しく聞く' }))

    expect(screen.getByPlaceholderText('この問題について質問する...')).toBeInTheDocument()
  })

  it('submits the question with the question context and shows the answer', async () => {
    vi.mocked(askTutor).mockResolvedValue({ status: 'ok', answer: '現在完了は継続を表すためです。' })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'もっと詳しく聞く' }))
    fireEvent.change(screen.getByPlaceholderText('この問題について質問する...'), {
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

    fireEvent.click(screen.getByRole('button', { name: 'もっと詳しく聞く' }))
    fireEvent.change(screen.getByPlaceholderText('この問題について質問する...'), { target: { value: '質問' } })
    fireEvent.click(screen.getByRole('button', { name: '質問する' }))

    expect(await screen.findByText('本日の質問回数上限に達しました。')).toBeInTheDocument()
  })

  it('disables the submit button and does not call askTutor while the question is empty', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'もっと詳しく聞く' }))

    expect(screen.getByRole('button', { name: '質問する' })).toBeDisabled()
    expect(askTutor).not.toHaveBeenCalled()
  })
})
