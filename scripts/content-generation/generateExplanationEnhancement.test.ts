import { describe, expect, it, vi } from 'vitest'
import { generateGrammarExplanations, generateVocabExplanations } from './generateExplanationEnhancement'

vi.mock('./env', () => ({
  loadEnv: vi.fn(() => ({
    SUPABASE_URL: 'http://example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    GEMINI_API_KEY: 'test-api-key',
    GEMINI_MODEL: 'gemini-test-model',
  })),
}))

type MockResult = { data: unknown; error: unknown }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => Promise.resolve(result))
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

const weakGrammarQuestion = {
  id: 'q-1',
  questionText: 'The company ___ its report by Friday.',
  choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
  correctIndex: 0,
  explanation: '未来完了形を使う。',
  accuracyRate: 0.5,
  attemptCount: 8,
}

const weakVocabWord = {
  id: 'v-1',
  word: 'negotiate',
  meaningJa: '交渉する',
  etymologyNote: 'neg-note',
  againRate: 0.4,
  reviewCount: 6,
}

describe('generateGrammarExplanations (11.3)', () => {
  it('creates a grammar_explanation batch, embeds target_id/context in the prompt, and stores pending items', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-1' }, error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateGrammarExplanations>[1]['supabase']

    const geminiItems = [{ target_id: 'q-1', additional_explanation: 'よくある間違いの補足。' }]
    const generateJsonArray = vi.fn().mockResolvedValue({ items: geminiItems, truncated: false, parseRecovered: false })

    const result = await generateGrammarExplanations(
      { items: [weakGrammarQuestion] },
      { supabase, generateJsonArray },
    )

    expect(result).toEqual({ batchId: 'batch-1', itemCount: 1, truncated: false })

    const batchInsertBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batches',
    )!.value as Record<string, ReturnType<typeof vi.fn>>
    expect(batchInsertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ content_type: 'grammar_explanation' }),
    )

    const promptArg = generateJsonArray.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('"target_id": "q-1"')
    expect(promptArg).toContain('"question_text": "The company ___ its report by Friday."')

    const itemsBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batch_items',
    )!.value as Record<string, ReturnType<typeof vi.fn>>
    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { batch_id: 'batch-1', raw_payload: geminiItems[0], status: 'pending_validation' },
    ])
  })

  it('records a note on generation_batches when the Gemini output was truncated', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-trunc' }, error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateGrammarExplanations>[1]['supabase']
    const generateJsonArray = vi.fn().mockResolvedValue({ items: [], truncated: true, parseRecovered: true })

    const result = await generateGrammarExplanations(
      { items: [weakGrammarQuestion] },
      { supabase, generateJsonArray },
    )

    expect(result).toEqual({ batchId: 'batch-trunc', itemCount: 0, truncated: true })
    const batchesCalls = fromMock.mock.calls
      .map((call, i) => ({ call, result: fromMock.mock.results[i].value as Record<string, ReturnType<typeof vi.fn>> }))
      .filter((c) => c.call[0] === 'generation_batches')
    const updateBuilder = batchesCalls[batchesCalls.length - 1].result
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ notes: expect.stringContaining('依頼1件中0件のみ生成・保存') }),
    )
  })
})

describe('generateVocabExplanations (11.3)', () => {
  it('creates a vocab_explanation batch and embeds target_id/context in the prompt', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-2' }, error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabExplanations>[1]['supabase']

    const geminiItems = [{ target_id: 'v-1', additional_explanation: '綴りが似た語との違い。' }]
    const generateJsonArray = vi.fn().mockResolvedValue({ items: geminiItems, truncated: false, parseRecovered: false })

    const result = await generateVocabExplanations({ items: [weakVocabWord] }, { supabase, generateJsonArray })

    expect(result).toEqual({ batchId: 'batch-2', itemCount: 1, truncated: false })

    const batchInsertBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batches',
    )!.value as Record<string, ReturnType<typeof vi.fn>>
    expect(batchInsertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ content_type: 'vocab_explanation' }))

    const promptArg = generateJsonArray.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('"target_id": "v-1"')
    expect(promptArg).toContain('"word": "negotiate"')
  })
})
