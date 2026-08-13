import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import VocabProgressHub from './VocabProgressHub'
import type { VocabProgressStats } from '../lib/queries/vocab'

const baseStats: VocabProgressStats = {
  totalWords: 100,
  newCount: 40,
  learningCount: 10,
  reviewCount: 45,
  relearningCount: 5,
  dueCount: 8,
  averageStability: 12.34,
}

describe('VocabProgressHub', () => {
  it('renders the full variant with mastery rate, due count, average stability, and state breakdown', () => {
    render(<VocabProgressHub variant="full" stats={baseStats} />)

    // 定着率 = (review 45 + relearning 5) / totalWords 100 = 50%
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('8件')).toBeInTheDocument()
    expect(screen.getByText('12.3日')).toBeInTheDocument()
    expect(screen.getByText('新規')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('学習中')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('復習')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('再学習')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders a 0% mastery rate without dividing by zero when totalWords is 0', () => {
    render(
      <VocabProgressHub
        variant="full"
        stats={{ totalWords: 0, newCount: 0, learningCount: 0, reviewCount: 0, relearningCount: 0, dueCount: 0, averageStability: 0 }}
      />,
    )
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getByText('0件')).toBeInTheDocument()
    expect(screen.getByText('0.0日')).toBeInTheDocument()
  })

  it('renders the compact variant without delta badges when `before` is omitted', () => {
    render(<VocabProgressHub variant="compact" stats={baseStats} />)

    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.queryByText(/pt$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('renders a mastery-rate delta badge and per-row deltas in the compact variant when `before` is provided', () => {
    const before: VocabProgressStats = {
      totalWords: 100,
      newCount: 42,
      learningCount: 11,
      reviewCount: 43,
      relearningCount: 4,
      dueCount: 10,
      averageStability: 11,
    }

    render(<VocabProgressHub variant="compact" stats={baseStats} before={before} />)

    // 定着率: before (43+4)/100=47% -> after 50% => +3pt
    expect(screen.getByText('+3pt')).toBeInTheDocument()
    // 復習: 43 -> 45 (+2)
    expect(screen.getByText('+2')).toBeInTheDocument()
    // 再学習: 4 -> 5 (+1)
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('omits the delta label for a state row that did not change', () => {
    const before: VocabProgressStats = { ...baseStats }
    render(<VocabProgressHub variant="compact" stats={baseStats} before={before} />)
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
  })
})
