import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockResult = { data: unknown; error: unknown }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.order = vi.fn(chain)
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

const { getGrammarCategoryStats, getVocabTagStats } = await import('./weakPoints')

beforeEach(() => {
  fromMock.mockReset()
})

describe('getGrammarCategoryStats', () => {
  it('maps view rows to camelCase, ordered by accuracy ascending (weakest first)', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'user_grammar_category_stats') {
        return makeQueryBuilder({
          data: [
            {
              category_id: 3,
              category_code: 'subjunctive',
              category_name: '仮定法',
              total_attempts: 3,
              correct_attempts: 1,
              accuracy_rate: 0.333,
              last_attempted_at: '2026-08-01T00:00:00.000Z',
            },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const stats = await getGrammarCategoryStats('user-1')
    expect(stats).toEqual([
      {
        categoryId: 3,
        categoryCode: 'subjunctive',
        categoryName: '仮定法',
        totalAttempts: 3,
        correctAttempts: 1,
        accuracyRate: 0.333,
        lastAttemptedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
  })

  it('throws when the query returns an error', async () => {
    fromMock.mockImplementation(() => makeQueryBuilder({ data: null, error: new Error('boom') }))
    await expect(getGrammarCategoryStats('user-1')).rejects.toThrow('boom')
  })
})

describe('getVocabTagStats', () => {
  it('maps view rows to camelCase', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'user_vocab_tag_stats') {
        return makeQueryBuilder({
          data: [
            {
              tag_id: 3,
              tag_code: 'part7',
              tag_name: 'Part7頻出',
              total_reviews: 12,
              correct_reviews: 4,
              accuracy_rate: 0.333,
              last_reviewed_at: '2026-08-01T00:00:00.000Z',
            },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const stats = await getVocabTagStats('user-1')
    expect(stats).toEqual([
      {
        tagId: 3,
        tagCode: 'part7',
        tagName: 'Part7頻出',
        totalReviews: 12,
        correctReviews: 4,
        accuracyRate: 0.333,
        lastReviewedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
  })

  it('throws when the query returns an error', async () => {
    fromMock.mockImplementation(() => makeQueryBuilder({ data: null, error: new Error('boom') }))
    await expect(getVocabTagStats('user-1')).rejects.toThrow('boom')
  })
})
