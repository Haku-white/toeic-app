import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateBatch } from './validateBatch'

type MockResult = { data: unknown; error: unknown }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.update = vi.fn(() => builder)
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

const validGrammarItem = {
  question_text: 'The company ___ its report by Friday.',
  choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
  correct_index: 0,
  explanation: '未来完了形を使う。',
  difficulty: 3,
  category_code: 'tense',
}

const validVocabItem = {
  word: 'negotiate',
  part_of_speech: 'verb',
  meaning_ja: '交渉する',
  example_sentence_en: 'We need to negotiate the contract.',
  example_sentence_ja: '契約について交渉する必要がある。',
  toeic_band: 730,
  etymology_note: 'neg-(否定)+otium(暇)→「暇ではない」',
  tags: ['ビジネス'],
}

function makeUpdateSpies() {
  const itemUpdates: Array<{ id: string; fields: Record<string, unknown> }> = []
  const batchUpdates: Array<Record<string, unknown>> = []
  return { itemUpdates, batchUpdates }
}

describe('validateBatch (grammar)', () => {
  let itemUpdates: Array<{ id: string; fields: Record<string, unknown> }>
  let batchUpdates: Array<Record<string, unknown>>
  let rpcMock: ReturnType<typeof vi.fn>
  let generateJson: ReturnType<typeof vi.fn>

  function buildSupabase(itemRows: { id: string; raw_payload: unknown; status: string }[]) {
    const spies = makeUpdateSpies()
    itemUpdates = spies.itemUpdates
    batchUpdates = spies.batchUpdates

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') {
        const builder = makeQueryBuilder({ data: { content_type: 'grammar' }, error: null })
        builder.update = vi.fn((fields: Record<string, unknown>) => {
          batchUpdates.push(fields)
          return builder
        })
        return builder
      }
      if (table === 'generation_batch_items') {
        const builder = makeQueryBuilder({ data: itemRows, error: null })
        builder.update = vi.fn((fields: Record<string, unknown>) => {
          // .eq('id', itemId) が呼ばれた時点でidを記録する
          const chained = { ...builder }
          chained.eq = vi.fn((_col: string, id: string) => {
            itemUpdates.push({ id, fields })
            return Promise.resolve({ data: null, error: null })
          })
          return chained
        })
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    })

    return { from, rpc: rpcMock } as unknown as Parameters<typeof validateBatch>[1]['supabase']
  }

  beforeEach(() => {
    rpcMock = vi.fn().mockResolvedValue({ data: [], error: null })
    generateJson = vi.fn()
  })

  it('marks a structurally invalid item as needs_review without calling duplicate check or self-check', async () => {
    const supabase = buildSupabase([
      { id: 'item-1', raw_payload: { ...validGrammarItem, choices: ['a', 'b'] }, status: 'pending_validation' },
    ])

    const result = await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])

    expect(result).toEqual({ total: 1, autoPassed: 0, needsReview: 1, totalItemsInBatch: 1 })
    expect(itemUpdates[0].fields.status).toBe('needs_review')
    expect(rpcMock).not.toHaveBeenCalled()
    expect(generateJson).not.toHaveBeenCalled()
  })

  it('marks an item as needs_review when a similar existing question is found', async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: 'existing-1', question_text: 'similar', similarity: 0.8 }],
      error: null,
    })
    const supabase = buildSupabase([{ id: 'item-1', raw_payload: validGrammarItem, status: 'pending_validation' }])

    const result = await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])

    expect(result).toEqual({ total: 1, autoPassed: 0, needsReview: 1, totalItemsInBatch: 1 })
    expect(itemUpdates[0].fields.status).toBe('needs_review')
    expect(generateJson).not.toHaveBeenCalled()
  })

  it('marks an item auto_passed when structural + duplicate + self-check all pass', async () => {
    generateJson.mockResolvedValue({ reasoning: 'r', solved_index: 0, is_ambiguous: false, confidence: 0.95 })
    const supabase = buildSupabase([{ id: 'item-1', raw_payload: validGrammarItem, status: 'pending_validation' }])

    const result = await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])

    expect(result).toEqual({ total: 1, autoPassed: 1, needsReview: 0, totalItemsInBatch: 1 })
    expect(itemUpdates[0].fields.status).toBe('auto_passed')
    expect((itemUpdates[0].fields.self_check_payload as { solved_index: number }).solved_index).toBe(0)
  })

  it('marks an item needs_review when the self-check disagrees with the declared correct_index', async () => {
    generateJson.mockResolvedValue({ reasoning: 'r', solved_index: 1, is_ambiguous: false, confidence: 0.95 })
    const supabase = buildSupabase([{ id: 'item-1', raw_payload: validGrammarItem, status: 'pending_validation' }])

    const result = await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])

    expect(result).toEqual({ total: 1, autoPassed: 0, needsReview: 1, totalItemsInBatch: 1 })
    expect(itemUpdates[0].fields.status).toBe('needs_review')
  })

  it('marks an item needs_review (without crashing) when the self-check throws unexpectedly, and continues to the next item', async () => {
    // 実データで発生した事例の再現: セルフチェックのレスポンスがJSON Schemaに従わず
    // (例: solved_indexが0〜3の範囲外)、selfCheckResultSchema.parse()がZodErrorを投げるケース。
    generateJson
      .mockRejectedValueOnce(new Error('solved_index out of range'))
      .mockResolvedValueOnce({ reasoning: 'r', solved_index: 0, is_ambiguous: false, confidence: 0.95 })
    const supabase = buildSupabase([
      { id: 'item-1', raw_payload: validGrammarItem, status: 'pending_validation' },
      { id: 'item-2', raw_payload: validGrammarItem, status: 'pending_validation' },
    ])

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])
    consoleErrorSpy.mockRestore()

    expect(result).toEqual({ total: 2, autoPassed: 1, needsReview: 1, totalItemsInBatch: 2 })
    expect(itemUpdates[0].fields.status).toBe('needs_review')
    expect((itemUpdates[0].fields.validation_errors as string[])[0]).toContain('予期しないエラー')
    expect(itemUpdates[1].fields.status).toBe('auto_passed')
  })

  it('sets the batch status to needs_review when at least one item needs review', async () => {
    const supabase = buildSupabase([
      { id: 'item-1', raw_payload: { ...validGrammarItem, choices: ['a', 'b'] }, status: 'pending_validation' },
    ])
    await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])
    expect(batchUpdates.at(-1)).toEqual({ needs_review_count: 1, status: 'needs_review' })
  })

  it('ignores items that are not pending_validation and counts them in totalItemsInBatch', async () => {
    const supabase = buildSupabase([
      { id: 'item-1', raw_payload: validGrammarItem, status: 'committed' },
      { id: 'item-2', raw_payload: validGrammarItem, status: 'rejected' },
    ])

    const result = await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])

    expect(result).toEqual({ total: 0, autoPassed: 0, needsReview: 0, totalItemsInBatch: 2 })
    expect(itemUpdates).toEqual([])
    expect(generateJson).not.toHaveBeenCalled()
  })

  it('does not touch generation_batches at all when there are no pending_validation items (avoids resetting an already-completed batch)', async () => {
    const supabase = buildSupabase([{ id: 'item-1', raw_payload: validGrammarItem, status: 'committed' }])
    await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])
    expect(batchUpdates).toEqual([])
  })

  it('returns totalItemsInBatch: 0 when the batch has no generation_batch_items at all', async () => {
    const supabase = buildSupabase([])
    const result = await validateBatch('batch-1', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])
    expect(result).toEqual({ total: 0, autoPassed: 0, needsReview: 0, totalItemsInBatch: 0 })
  })
})

describe('validateBatch (vocab)', () => {
  it('auto-passes a well-formed, non-duplicate vocab item without a self-check call', async () => {
    const itemUpdates: Array<{ id: string; fields: Record<string, unknown> }> = []
    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const generateJson = vi.fn()

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') {
        const builder = makeQueryBuilder({ data: { content_type: 'vocab' }, error: null })
        builder.update = vi.fn(() => builder)
        return builder
      }
      if (table === 'generation_batch_items') {
        const builder = makeQueryBuilder({
          data: [{ id: 'item-1', raw_payload: validVocabItem, status: 'pending_validation' }],
          error: null,
        })
        builder.update = vi.fn((fields: Record<string, unknown>) => {
          const chained = { ...builder }
          chained.eq = vi.fn((_col: string, id: string) => {
            itemUpdates.push({ id, fields })
            return Promise.resolve({ data: null, error: null })
          })
          return chained
        })
        return builder
      }
      if (table === 'vocab_words') {
        return makeQueryBuilder({ data: [], error: null })
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from, rpc: rpcMock } as unknown as Parameters<typeof validateBatch>[1]['supabase']

    const result = await validateBatch('batch-2', { supabase, generateJson } as unknown as Parameters<typeof validateBatch>[1])

    expect(result).toEqual({ total: 1, autoPassed: 1, needsReview: 0, totalItemsInBatch: 1 })
    expect(itemUpdates[0].fields.status).toBe('auto_passed')
    expect(generateJson).not.toHaveBeenCalled()
  })
})
