import { describe, expect, it, vi } from 'vitest'
import { generateGrammarBatch } from './generateGrammar'

// .envに依存せずテストを決定的にするため、また「CLIで--modelを指定しない限り
// env.GEMINI_MODELがそのままモデル名として使われる」という修正済みの挙動を検証するためモックする。
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
  builder.eq = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.limit = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

describe('generateGrammarBatch', () => {
  it('creates a batch, fetches existing samples for the category, calls Gemini, and stores pending items', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'grammar_categories') {
        return makeQueryBuilder({ data: { id: 3, name_ja: '仮定法' }, error: null })
      }
      if (table === 'generation_batches') {
        return makeQueryBuilder({ data: { id: 'batch-1' }, error: null })
      }
      if (table === 'grammar_questions') {
        return makeQueryBuilder({ data: [{ question_text: 'If I had more time...' }], error: null })
      }
      if (table === 'generation_batch_items') {
        return makeQueryBuilder({ data: null, error: null })
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateGrammarBatch>[1]['supabase']

    const geminiItems = [
      {
        question_text: 'If the meeting ___ postponed, we would have missed it.',
        choices: ['is', 'was', 'had been', 'were'],
        correct_index: 2,
        explanation: '仮定法過去完了を使う。',
        difficulty: 4,
        category_code: 'subjunctive',
      },
    ]
    const generateJson = vi.fn().mockResolvedValue(geminiItems)

    const result = await generateGrammarBatch(
      { categoryCode: 'subjunctive', count: 1, difficulty: 4, targetBand: 730 },
      { supabase, generateJson },
    )

    expect(result).toEqual({ batchId: 'batch-1', itemCount: 1 })

    // プロンプトに既存問題サンプルが埋め込まれていること
    expect(generateJson).toHaveBeenCalledTimes(1)
    const promptArg = generateJson.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('仮定法（subjunctive）')
    expect(promptArg).toContain('If I had more time...')

    // --modelを指定しない場合、.env(env.GEMINI_MODEL)の値がそのままモデル名として使われること
    // （以前は'gemini-2.5-flash'が直書きされておりGEMINI_MODELが無視されていた不具合の再発防止）
    expect(generateJson.mock.calls[0][0].model).toBe('gemini-test-model')
    const batchInsertBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batches',
    )!.value
    expect(batchInsertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ model_name: 'gemini-test-model' }),
    )

    // generation_batch_items に pending_validation で保存されていること
    const itemsBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batch_items',
    )!.value
    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { batch_id: 'batch-1', raw_payload: geminiItems[0], status: 'pending_validation' },
    ])

    // generation_batches が generated_count / status='validating' で更新されていること
    const batchesCalls = fromMock.mock.calls
      .map((call, i) => ({ call, result: fromMock.mock.results[i].value }))
      .filter((c) => c.call[0] === 'generation_batches')
    const updateBuilder = batchesCalls[batchesCalls.length - 1].result
    expect(updateBuilder.update).toHaveBeenCalledWith({ generated_count: 1, status: 'validating' })
  })

  it('propagates an error when the category lookup fails', async () => {
    const fromMock = vi.fn(() => makeQueryBuilder({ data: null, error: new Error('no such category') }))
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateGrammarBatch>[1]['supabase']
    const generateJson = vi.fn()

    await expect(
      generateGrammarBatch(
        { categoryCode: 'unknown', count: 1, difficulty: 1, targetBand: 600 },
        { supabase, generateJson },
      ),
    ).rejects.toThrow('no such category')
    expect(generateJson).not.toHaveBeenCalled()
  })
})
