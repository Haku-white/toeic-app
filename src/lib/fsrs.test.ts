import { describe, expect, it } from 'vitest'
import { computeNextState, DESIRED_RETENTION, type VocabProgressState } from './fsrs'

const NOW = new Date('2026-08-09T00:00:00.000Z')

describe('computeNextState', () => {
  it('exposes the desired retention decided in DESIGN.md 3章 (0.92)', () => {
    expect(DESIRED_RETENTION).toBe(0.92)
  })

  it('treats a null progress (new card) as state=new with zeroed stats', () => {
    const { progress } = computeNextState(null, 'good', NOW)
    expect(progress.reps).toBe(1)
    expect(progress.lapses).toBe(0)
    expect(new Date(progress.dueAt).getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('produces a review log whose rating matches the input rating', () => {
    const { reviewLog } = computeNextState(null, 'easy', NOW)
    expect(reviewLog.rating).toBe('easy')
  })

  it.each(['again', 'hard', 'good', 'easy'] as const)(
    'returns a valid state for a new card rated "%s"',
    (rating) => {
      const { progress } = computeNextState(null, rating, NOW)
      expect(['new', 'learning', 'review', 'relearning']).toContain(progress.state)
      expect(Number.isFinite(progress.stability)).toBe(true)
      expect(Number.isFinite(progress.difficulty)).toBe(true)
    },
  )

  it('schedules "easy" further out than "again" from the same starting point', () => {
    const again = computeNextState(null, 'again', NOW)
    const easy = computeNextState(null, 'easy', NOW)
    const againDue = new Date(again.progress.dueAt).getTime()
    const easyDue = new Date(easy.progress.dueAt).getTime()
    expect(easyDue).toBeGreaterThan(againDue)
  })

  it('increments lapses when an established review card is rated "again"', () => {
    // シミュレート: 何度か復習を重ねた既存カード（review状態）
    let state: VocabProgressState | null = null
    let cursor = NOW
    for (const rating of ['good', 'good', 'good'] as const) {
      const result = computeNextState(state, rating, cursor)
      state = result.progress
      cursor = new Date(new Date(result.progress.dueAt).getTime())
    }
    expect(state).not.toBeNull()
    expect(state!.state).toBe('review')
    const lapsesBefore = state!.lapses

    const { progress: afterAgain } = computeNextState(state, 'again', cursor)
    expect(afterAgain.state).toBe('relearning')
    expect(afterAgain.lapses).toBe(lapsesBefore + 1)
  })

  it('advances reps by exactly 1 per review regardless of rating', () => {
    const { progress: p1 } = computeNextState(null, 'good', NOW)
    const { progress: p2 } = computeNextState(p1, 'hard', new Date(p1.dueAt))
    expect(p2.reps).toBe(p1.reps + 1)
  })

  it('is a pure function: calling it twice with identical inputs yields identical output', () => {
    const a = computeNextState(null, 'good', NOW)
    const b = computeNextState(null, 'good', NOW)
    expect(a).toEqual(b)
  })

  it('carries lastReviewAt forward as the review timestamp', () => {
    const { progress } = computeNextState(null, 'good', NOW)
    expect(progress.lastReviewAt).toBe(NOW.toISOString())
  })
})
