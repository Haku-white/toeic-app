import { describe, expect, it, vi } from 'vitest'
import { generateVocabBatch, IDIOM_TAG_NAME } from './generateVocab'

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
  builder.in = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.limit = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

describe('generateVocabBatch', () => {
  it('creates a batch, includes existing DB-wide words (regardless of tag) as dedup context, and stores pending items', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-2' }, error: null })
      // 20260813改修: 重複回避コンテキストはタグ単位ではなくDB全体のvocab_wordsを直接見る
      // （vocab_tags/vocab_word_tagsを経由したタグ絞り込みは行わない）。
      if (table === 'vocab_words') return makeQueryBuilder({ data: [{ word: 'negotiate' }], error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']

    const geminiItems = [
      {
        word: 'reimburse',
        part_of_speech: 'verb',
        meaning_ja: '払い戻す',
        example_sentence_en: 'The company will reimburse your expenses.',
        example_sentence_ja: '会社が費用を払い戻す。',
        toeic_band: 730,
        etymology_note: 're-(再び)+im-(中に)+bursa(財布)→「財布に戻す」',
        tags: ['ビジネス'],
      },
    ]
    const generateJson = vi.fn().mockResolvedValue(geminiItems)

    const result = await generateVocabBatch(
      { tagName: 'ビジネス', count: 1, targetBand: 730 },
      { supabase, generateJson },
    )

    expect(result).toEqual({ batchId: 'batch-2', itemCount: 1 })

    const promptArg = generateJson.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('【テーマ】\nビジネス')
    expect(promptArg).toContain('- negotiate')

    // --modelを指定しない場合、.env(env.GEMINI_MODEL)の値がそのままモデル名として使われること
    expect(generateJson.mock.calls[0][0].model).toBe('gemini-test-model')

    const itemsBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batch_items',
    )!.value
    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { batch_id: 'batch-2', raw_payload: geminiItems[0], status: 'pending_validation' },
    ])
  })

  it('uses an empty dedup list when there are no existing vocab_words yet', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-3' }, error: null })
      if (table === 'vocab_words') return makeQueryBuilder({ data: [], error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']
    const generateJson = vi.fn().mockResolvedValue([])

    const result = await generateVocabBatch(
      { tagName: '新テーマ', count: 1, targetBand: 600 },
      { supabase, generateJson },
    )

    expect(result).toEqual({ batchId: 'batch-3', itemCount: 0 })
    const promptArg = generateJson.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('（なし）')
  })

  it('throws when tagName is omitted and contentKind is the default "vocab"', async () => {
    const supabase = { from: vi.fn() } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']
    const generateJson = vi.fn()
    await expect(generateVocabBatch({ count: 1, targetBand: 600 }, { supabase, generateJson })).rejects.toThrow(
      'tagName は必須です',
    )
    expect(generateJson).not.toHaveBeenCalled()
  })

  describe('contentKind="idiom" (13.2)', () => {
    it('ignores tagName, uses DB-wide dedup context (regardless of tag), and builds the idiom prompt', async () => {
      const fromMock = vi.fn((table: string) => {
        if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-4' }, error: null })
        if (table === 'vocab_words') {
          return makeQueryBuilder({ data: [{ word: 'get the ball rolling' }], error: null })
        }
        if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
        throw new Error(`unexpected table: ${table}`)
      })
      const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']

      const geminiItems = [
        {
          word: 'break the ice',
          part_of_speech: 'idiom',
          meaning_ja: '緊張をほぐす',
          example_sentence_en: 'She told a joke to break the ice.',
          example_sentence_ja: '彼女は冗談を言って場の緊張をほぐした。',
          toeic_band: 730,
          etymology_note: '文字通りには「氷を割る」→そこから「緊張をほぐす」という意味に発展',
          tags: [IDIOM_TAG_NAME],
        },
      ]
      const generateJson = vi.fn().mockResolvedValue(geminiItems)

      const result = await generateVocabBatch(
        { contentKind: 'idiom', count: 1, targetBand: 730 },
        { supabase, generateJson },
      )

      expect(result).toEqual({ batchId: 'batch-4', itemCount: 1 })

      const promptArg = generateJson.mock.calls[0][0].prompt as string
      expect(promptArg).toContain('イディオム（慣用表現）')
      expect(promptArg).toContain('- get the ball rolling')
      expect(promptArg).not.toContain('【テーマ】') // vocab.md固有の見出しは含まれない
    })
  })
})
