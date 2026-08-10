import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VocabWordRow } from './vocab'

type MockResult = { data: unknown; error: unknown }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.in = vi.fn(chain)
  builder.limit = vi.fn(chain)
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

const fromMock = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}))

const identityShuffle = <T>(items: T[]) => items

const { buildVocabQuizQuestion, getMixedDrillQuestions, mapMixedDrillAnswerToRating } =
  await import('./mixedDrill')

function makeWord(overrides: Partial<VocabWordRow>): VocabWordRow {
  return {
    id: 'word-1',
    word: 'negotiate',
    part_of_speech: 'verb',
    meaning_ja: '交渉する',
    example_sentence_en: 'We negotiate.',
    example_sentence_ja: '交渉する。',
    etymology_note: 'note',
    ...overrides,
  }
}

describe('buildVocabQuizQuestion', () => {
  const target = makeWord({ id: 'target', word: 'negotiate', meaning_ja: '交渉する', etymology_note: 'neg-note' })
  const pool = [
    target,
    makeWord({ id: 'w2', word: 'reimburse', meaning_ja: '払い戻す' }),
    makeWord({ id: 'w3', word: 'subsidiary', meaning_ja: '子会社' }),
    makeWord({ id: 'w4', word: 'inventory', meaning_ja: '在庫' }),
    makeWord({ id: 'w5', word: 'deduct', meaning_ja: '控除する' }),
  ]

  it('builds a 4-choice question with the correct answer at the identity-shuffle position', () => {
    const question = buildVocabQuizQuestion(target, pool, null, identityShuffle)

    expect(question.kind).toBe('vocab')
    expect(question.questionText).toBe('「negotiate」の意味として最も適切なものを選んでください。')
    expect(question.choices).toHaveLength(4)
    expect(question.choices[question.correctIndex]).toBe('交渉する')
    expect(question.explanation).toBe('neg-note')
    expect(question.vocabWordId).toBe('target')
  })

  it('never includes the target word itself as a distractor', () => {
    const question = buildVocabQuizQuestion(target, pool, null, identityShuffle)
    const distractors = question.choices.filter((_c, i) => i !== question.correctIndex)
    expect(distractors).not.toContain(target.meaning_ja)
    expect(distractors).toEqual(['払い戻す', '子会社', '在庫'])
  })

  it('excludes distractor candidates whose meaning duplicates the correct answer', () => {
    const poolWithDuplicateMeaning = [
      target,
      makeWord({ id: 'dup', word: 'confer', meaning_ja: '交渉する' }), // 意味が正解と重複
      makeWord({ id: 'w2', word: 'reimburse', meaning_ja: '払い戻す' }),
      makeWord({ id: 'w3', word: 'subsidiary', meaning_ja: '子会社' }),
    ]
    const question = buildVocabQuizQuestion(target, poolWithDuplicateMeaning, null, identityShuffle)
    const distractors = question.choices.filter((_c, i) => i !== question.correctIndex)
    expect(distractors).not.toContain('交渉する')
    expect(new Set(question.choices).size).toBe(question.choices.length) // 全選択肢が一意
  })

  it('carries the given vocabProgress through unchanged', () => {
    const progress = { state: 'review', dueAt: '2026-01-01', stability: 1, difficulty: 1, elapsedDays: 1, scheduledDays: 1, reps: 1, lapses: 0, lastReviewAt: null } as const
    const question = buildVocabQuizQuestion(target, pool, progress, identityShuffle)
    expect(question.vocabProgress).toEqual(progress)
  })
})

describe('mapMixedDrillAnswerToRating (14.4)', () => {
  it('maps a correct 4-choice answer to "hard", not "good"', () => {
    expect(mapMixedDrillAnswerToRating(true)).toBe('hard')
  })

  it('maps an incorrect answer to "again"', () => {
    expect(mapMixedDrillAnswerToRating(false)).toBe('again')
  })
})

describe('getMixedDrillQuestions', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('combines grammar and vocab questions and shuffles the combined list', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'grammar_questions') {
        return makeQueryBuilder({
          data: [
            {
              id: 'q1',
              category_id: 1,
              question_text: 'Grammar Q',
              choices: ['a', 'b', 'c', 'd'],
              correct_index: 0,
              explanation: 'exp',
              difficulty: 2,
            },
          ],
          error: null,
        })
      }
      if (table === 'vocab_words') {
        return makeQueryBuilder({
          data: [makeWord({ id: 'v1', word: 'negotiate', meaning_ja: '交渉する' })],
          error: null,
        })
      }
      if (table === 'user_vocab_progress') {
        return makeQueryBuilder({ data: [], error: null })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const questions = await getMixedDrillQuestions('user-1', 1, 1, identityShuffle)

    expect(questions).toHaveLength(2)
    expect(questions.filter((q) => q.kind === 'grammar')).toHaveLength(1)
    expect(questions.filter((q) => q.kind === 'vocab')).toHaveLength(1)
    expect(questions[0].grammarQuestionId).toBe('q1')
    expect(questions[1].vocabWordId).toBe('v1')
  })

  it('attaches the existing user_vocab_progress to vocab questions when present', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'grammar_questions') return makeQueryBuilder({ data: [], error: null })
      if (table === 'vocab_words') {
        return makeQueryBuilder({ data: [makeWord({ id: 'v1' })], error: null })
      }
      if (table === 'user_vocab_progress') {
        return makeQueryBuilder({
          data: [
            {
              vocab_word_id: 'v1',
              state: 'review',
              due_at: '2026-01-01T00:00:00.000Z',
              stability: 5,
              difficulty: 3,
              elapsed_days: 4,
              scheduled_days: 4,
              reps: 3,
              lapses: 0,
              last_review_at: '2025-12-28T00:00:00.000Z',
            },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const questions = await getMixedDrillQuestions('user-1', 0, 1, identityShuffle)

    expect(questions).toHaveLength(1)
    expect(questions[0].vocabProgress).toMatchObject({ state: 'review', reps: 3 })
  })

  it('returns an empty vocab set (no error) when there are no vocab_words yet', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'grammar_questions') return makeQueryBuilder({ data: [], error: null })
      if (table === 'vocab_words') return makeQueryBuilder({ data: [], error: null })
      throw new Error(`unexpected table: ${table}`)
    })

    const questions = await getMixedDrillQuestions('user-1', 0, 5, identityShuffle)
    expect(questions).toEqual([])
  })
})
