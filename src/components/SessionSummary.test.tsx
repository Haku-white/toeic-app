import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SessionSummary, { SessionSummaryAction } from './SessionSummary'

function accuracyText(pct: string) {
  return screen.getByText((_content, element) => element?.tagName === 'DIV' && element.textContent === pct)
}

describe('SessionSummary', () => {
  it('shows the accuracy rate, question/correct count, and elapsed time', () => {
    render(<SessionSummary correctCount={8} totalCount={10} elapsedMs={4 * 60_000 + 12_000} />)

    expect(accuracyText('80%')).toBeInTheDocument()
    expect(screen.getByText('10 / 8')).toBeInTheDocument()
    expect(screen.getByText('4:12')).toBeInTheDocument()
  })

  it('shows a placeholder while elapsed time has not been measured yet', () => {
    render(<SessionSummary correctCount={1} totalCount={2} elapsedMs={null} />)
    expect(screen.getByText('—:—')).toBeInTheDocument()
  })

  it('pads seconds under 10 with a leading zero', () => {
    render(<SessionSummary correctCount={1} totalCount={1} elapsedMs={65_000} />)
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  it('lights the accuracy gauge ring in the correct tone at/above the 70% warning threshold', () => {
    render(<SessionSummary correctCount={7} totalCount={10} elapsedMs={0} />)
    expect(accuracyText('70%')).toBeInTheDocument()
    expect(screen.getByTestId('accuracy-ring')).toHaveAttribute('data-tone', 'correct')
  })

  it('lights the accuracy gauge ring in the incorrect tone below the 70% warning threshold', () => {
    render(<SessionSummary correctCount={6} totalCount={10} elapsedMs={0} />)
    expect(accuracyText('60%')).toBeInTheDocument()
    expect(screen.getByTestId('accuracy-ring')).toHaveAttribute('data-tone', 'incorrect')
  })

  it('renders a 0% accuracy without dividing by zero when totalCount is 0', () => {
    render(<SessionSummary correctCount={0} totalCount={0} elapsedMs={0} />)
    expect(accuracyText('0%')).toBeInTheDocument()
    expect(screen.getByText('0 / 0')).toBeInTheDocument()
  })

  it('renders category breakdown rows when provided (MixedDrillの文法/語彙内訳)', () => {
    render(
      <SessionSummary
        correctCount={9}
        totalCount={10}
        elapsedMs={0}
        categories={[
          { label: '文法', correct: 5, total: 5 },
          { label: '語彙', correct: 4, total: 5 },
        ]}
      />,
    )
    expect(accuracyText('90%')).toBeInTheDocument()
    expect(screen.getByText('文法')).toBeInTheDocument()
    expect(screen.getByText('語彙')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('does not render a category section when categories is omitted (GrammarDrillは単一カテゴリ)', () => {
    render(<SessionSummary correctCount={2} totalCount={2} elapsedMs={0} />)
    expect(screen.queryByText('文法')).not.toBeInTheDocument()
  })

  it('renders the actions slot when provided, and omits it otherwise', () => {
    const { rerender } = render(<SessionSummary correctCount={1} totalCount={1} elapsedMs={0} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <SessionSummary
          correctCount={1}
          totalCount={1}
          elapsedMs={0}
          actions={
            <SessionSummaryAction to="/" variant="primary">
              ホームに戻る
            </SessionSummaryAction>
          }
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'ホームに戻る' })).toHaveAttribute('href', '/')
  })
})
