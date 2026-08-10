import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockResult = { data: unknown; error: unknown }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.limit = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.insert = vi.fn(() => Promise.resolve(result))
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

const { getGrammarCategories, getGrammarDrillData, submitGrammarAttempt } = await import('./grammar')

beforeEach(() => {
  fromMock.mockReset()
})

describe('getGrammarCategories', () => {
  it('returns categories mapped to camelCase, ordered by sort_order', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'grammar_categories') {
        return makeQueryBuilder({
          data: [
            { id: 1, code: 'tense', name_ja: '時制', sort_order: 1 },
            { id: 2, code: 'voice', name_ja: '態(能動・受動)', sort_order: 2 },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const categories = await getGrammarCategories()
    expect(categories).toEqual([
      { id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 },
      { id: 2, code: 'voice', nameJa: '態(能動・受動)', sortOrder: 2 },
    ])
  })

  it('throws when the query returns an error', async () => {
    fromMock.mockImplementation(() => makeQueryBuilder({ data: null, error: new Error('boom') }))
    await expect(getGrammarCategories()).rejects.toThrow('boom')
  })
})

describe('getGrammarDrillData', () => {
  it('resolves the category by code, then fetches its questions', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'grammar_categories') {
        return makeQueryBuilder({ data: { id: 1, code: 'tense', name_ja: '時制', sort_order: 1 }, error: null })
      }
      if (table === 'grammar_questions') {
        return makeQueryBuilder({
          data: [
            {
              id: 'q-1',
              category_id: 1,
              question_text: 'The company ___ its report by Friday.',
              choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
              correct_index: 0,
              explanation: '未来完了形を使う。',
              difficulty: 2,
            },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const result = await getGrammarDrillData('tense', 10)
    expect(result.category).toEqual({ id: 1, code: 'tense', nameJa: '時制', sortOrder: 1 })
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]).toEqual({
      id: 'q-1',
      categoryId: 1,
      questionText: 'The company ___ its report by Friday.',
      choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
      correctIndex: 0,
      explanation: '未来完了形を使う。',
      difficulty: 2,
    })
  })

  it('throws when the category lookup fails', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'grammar_categories') {
        return makeQueryBuilder({ data: null, error: new Error('not found') })
      }
      throw new Error(`unexpected table: ${table}`)
    })
    await expect(getGrammarDrillData('unknown-code')).rejects.toThrow('not found')
  })
})

describe('submitGrammarAttempt', () => {
  it('inserts into user_grammar_attempts with the given payload', async () => {
    const insertSpy = vi.fn((_payload: Record<string, unknown>) => Promise.resolve({ data: null, error: null }))
    fromMock.mockImplementation((table: string) => {
      if (table === 'user_grammar_attempts') return { insert: insertSpy }
      throw new Error(`unexpected table: ${table}`)
    })

    await submitGrammarAttempt({
      userId: 'user-1',
      questionId: 'q-1',
      selectedIndex: 2,
      isCorrect: false,
      responseTimeMs: 4200,
    })

    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(insertSpy.mock.calls[0][0]).toEqual({
      user_id: 'user-1',
      question_id: 'q-1',
      selected_index: 2,
      is_correct: false,
      response_time_ms: 4200,
    })
  })

  it('throws when the insert fails', async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error('rls denied') }))
    fromMock.mockImplementation((table: string) => {
      if (table === 'user_grammar_attempts') return { insert: insertSpy }
      throw new Error(`unexpected table: ${table}`)
    })

    await expect(
      submitGrammarAttempt({ userId: 'user-1', questionId: 'q-1', selectedIndex: 0, isCorrect: true }),
    ).rejects.toThrow('rls denied')
  })
})
