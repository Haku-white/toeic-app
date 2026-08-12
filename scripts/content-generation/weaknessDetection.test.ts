import { describe, expect, it, vi } from 'vitest'
import { findWeakGrammarQuestions, findWeakVocabWords } from './weaknessDetection'

type MockResult = { data: unknown; error: unknown }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.gte = vi.fn(chain)
  builder.lt = vi.fn(chain)
  builder.is = vi.fn(chain)
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

describe('findWeakGrammarQuestions (11.1)', () => {
  it('fetches stats above the attempt threshold and below the accuracy threshold, then joins question text, excluding already-enhanced rows', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'grammar_question_accuracy_stats') {
        return makeQueryBuilder({
          data: [
            { question_id: 'q-1', attempt_count: 8, accuracy_rate: 0.5 },
            { question_id: 'q-2', attempt_count: 6, accuracy_rate: 0.6 },
          ],
          error: null,
        })
      }
      if (table === 'grammar_questions') {
        const builder: Record<string, unknown> = {}
        builder.select = vi.fn(() => builder)
        builder.eq = vi.fn((_col: string, id: string) => {
          if (id === 'q-1') {
            return makeQueryBuilder({
              data: {
                id: 'q-1',
                question_text: 'The company ___ its report by Friday.',
                choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
                correct_index: 0,
                explanation: '未来完了形を使う。',
              },
              error: null,
            })
          }
          // q-2は既にadditional_explanation設定済み → .is('additional_explanation', null)でnullになる想定
          return makeQueryBuilder({ data: null, error: null })
        })
        builder.is = vi.fn(() => builder)
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof findWeakGrammarQuestions>[0]

    const result = await findWeakGrammarQuestions(supabase, 5, 0.7)

    expect(result).toEqual([
      {
        id: 'q-1',
        questionText: 'The company ___ its report by Friday.',
        choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
        correctIndex: 0,
        explanation: '未来完了形を使う。',
        accuracyRate: 0.5,
        attemptCount: 8,
      },
    ])

    // 閾値のgte/ltがそれぞれの引数で呼ばれていること
    const statsBuilder = fromMock.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>
    expect(statsBuilder.gte).toHaveBeenCalledWith('attempt_count', 5)
    expect(statsBuilder.lt).toHaveBeenCalledWith('accuracy_rate', 0.7)
  })

  it('propagates an error from the stats query', async () => {
    const fromMock = vi.fn(() => makeQueryBuilder({ data: null, error: new Error('db down') }))
    const supabase = { from: fromMock } as unknown as Parameters<typeof findWeakGrammarQuestions>[0]
    await expect(findWeakGrammarQuestions(supabase)).rejects.toThrow('db down')
  })
})

describe('findWeakVocabWords (11.1)', () => {
  it('fetches stats above the review threshold and again-rate threshold, then joins word text, excluding already-enhanced rows', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'vocab_word_again_stats') {
        return makeQueryBuilder({
          data: [
            { vocab_word_id: 'v-1', review_count: 6, again_rate: 0.4 },
            { vocab_word_id: 'v-2', review_count: 5, again_rate: 0.35 },
          ],
          error: null,
        })
      }
      if (table === 'vocab_words') {
        const builder: Record<string, unknown> = {}
        builder.select = vi.fn(() => builder)
        builder.eq = vi.fn((_col: string, id: string) => {
          if (id === 'v-1') {
            return makeQueryBuilder({
              data: { id: 'v-1', word: 'negotiate', meaning_ja: '交渉する', etymology_note: 'neg-note' },
              error: null,
            })
          }
          return makeQueryBuilder({ data: null, error: null })
        })
        builder.is = vi.fn(() => builder)
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof findWeakVocabWords>[0]

    const result = await findWeakVocabWords(supabase, 5, 0.3)

    expect(result).toEqual([
      {
        id: 'v-1',
        word: 'negotiate',
        meaningJa: '交渉する',
        etymologyNote: 'neg-note',
        againRate: 0.4,
        reviewCount: 6,
      },
    ])

    const statsBuilder = fromMock.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>
    expect(statsBuilder.gte).toHaveBeenCalledWith('review_count', 5)
    expect(statsBuilder.gte).toHaveBeenCalledWith('again_rate', 0.3)
  })

  it('propagates an error from the stats query', async () => {
    const fromMock = vi.fn(() => makeQueryBuilder({ data: null, error: new Error('db down') }))
    const supabase = { from: fromMock } as unknown as Parameters<typeof findWeakVocabWords>[0]
    await expect(findWeakVocabWords(supabase)).rejects.toThrow('db down')
  })
})
