import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import QuestionCard from './QuestionCard'

vi.mock('../lib/queries/tutor', () => ({
  askTutor: vi.fn(),
}))

function renderQuestionCard(overrides: Partial<ComponentProps<typeof QuestionCard>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSelect = vi.fn()
  const onAdvance = vi.fn()
  const onAskTutorFocusChange = vi.fn()
  const props = {
    panelLabel: 'GRAMMAR DRILL',
    questionText: 'The company ___ its report by Friday.',
    choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
    correctIndex: 0,
    selectedIndex: null,
    onSelect,
    explanation: '未来完了形を使う。',
    additionalExplanation: null,
    onAdvance,
    isLastQuestion: false,
    onAskTutorFocusChange,
    ...overrides,
  }
  render(
    <QueryClientProvider client={queryClient}>
      <QuestionCard {...props} />
    </QueryClientProvider>,
  )
  return { onSelect, onAdvance, onAskTutorFocusChange }
}

describe('QuestionCard', () => {
  it('renders choices with "{label} {choice}" accessible names', () => {
    renderQuestionCard()
    expect(screen.getByRole('button', { name: /^2 submits$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^1 will have submitted$/ })).toBeInTheDocument()
  })

  it('calls onSelect with the clicked index when unanswered', () => {
    const { onSelect } = renderQuestionCard()
    fireEvent.click(screen.getByRole('button', { name: /^2 submits$/ }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('does not call onSelect again once a choice is already selected (disabled)', () => {
    const { onSelect } = renderQuestionCard({ selectedIndex: 1 })
    fireEvent.click(screen.getByRole('button', { name: /^3 submitted$/ }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('highlights the correct choice green, the selected wrong choice red, and dims the untouched choice', () => {
    renderQuestionCard({ selectedIndex: 1 })
    expect(screen.getByRole('button', { name: /^1 will have submitted$/ })).toHaveClass('border-correct-600')
    expect(screen.getByRole('button', { name: /^2 submits$/ })).toHaveClass('border-incorrect-600')
    const untouched = screen.getByRole('button', { name: /^3 submitted$/ })
    expect(untouched).not.toHaveClass('border-correct-600')
    expect(untouched).not.toHaveClass('border-incorrect-600')
    expect(untouched).toHaveClass('border-neutral-100')
  })

  it('renders the kindLabel badge when provided, and omits it otherwise', () => {
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <QuestionCard
          panelLabel="MIXED DRILL"
          kindLabel="文法"
          questionText="q"
          choices={['a', 'b']}
          correctIndex={0}
          selectedIndex={null}
          onSelect={vi.fn()}
          explanation={null}
          additionalExplanation={null}
          onAdvance={vi.fn()}
          isLastQuestion={false}
          onAskTutorFocusChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('文法')).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <QuestionCard
          panelLabel="MIXED DRILL"
          questionText="q"
          choices={['a', 'b']}
          correctIndex={0}
          selectedIndex={null}
          onSelect={vi.fn()}
          explanation={null}
          additionalExplanation={null}
          onAdvance={vi.fn()}
          isLastQuestion={false}
          onAskTutorFocusChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.queryByText('文法')).not.toBeInTheDocument()
  })

  it('shows the explanation and "よくある間違いのポイント" box only when provided, once answered', () => {
    renderQuestionCard({
      selectedIndex: 0,
      explanation: '未来完了形を使う。',
      additionalExplanation: '"since"は起点を表す前置詞。',
    })
    expect(screen.getByText('未来完了形を使う。')).toBeInTheDocument()
    expect(screen.getByText('よくある間違いのポイント')).toBeInTheDocument()
    expect(screen.getByText('"since"は起点を表す前置詞。')).toBeInTheDocument()
  })

  it('does not show the "よくある間違いのポイント" box when additionalExplanation is null', () => {
    renderQuestionCard({ selectedIndex: 0, additionalExplanation: null })
    expect(screen.queryByText('よくある間違いのポイント')).not.toBeInTheDocument()
  })

  it('shows "次の問題へ" and calls onAdvance, or "結果を見る" on the last question', () => {
    const { onAdvance } = renderQuestionCard({ selectedIndex: 0, isLastQuestion: false })
    fireEvent.click(screen.getByRole('button', { name: '次の問題へ' }))
    expect(onAdvance).toHaveBeenCalledTimes(1)

    renderQuestionCard({ selectedIndex: 0, isLastQuestion: true })
    expect(screen.getByRole('button', { name: '結果を見る' })).toBeInTheDocument()
  })

  it('forwards AskTutorPanel focus/blur to onAskTutorFocusChange', () => {
    const { onAskTutorFocusChange } = renderQuestionCard({ selectedIndex: 0 })
    fireEvent.click(screen.getByRole('button', { name: /もっと詳しく聞く/ }))
    const textarea = screen.getByPlaceholderText(/この問題について質問する/)

    fireEvent.focus(textarea)
    expect(onAskTutorFocusChange).toHaveBeenCalledWith(true)

    fireEvent.blur(textarea)
    expect(onAskTutorFocusChange).toHaveBeenCalledWith(false)
  })
})
