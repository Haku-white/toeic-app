import { describe, expect, it, vi } from 'vitest'
import { generateVocabBatch, generateVocabBatchFromWordlist, IDIOM_TAG_NAME } from './generateVocab'

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

/**
 * `vocab_words`は`getDbWideExistingWords`（`.order().limit()`のみ）と
 * `getSameTagExistingWords`（`.in(ids).order().limit()`）の2種類のクエリで呼ばれる
 * （2026-08-12改修）。`.in()`が呼ばれたかどうかで結果を出し分ける。
 */
function makeVocabWordsRouter(dbWideResult: MockResult, sameTagResult: MockResult) {
  return () => {
    const builder: Record<string, unknown> = {}
    let usedIn = false
    builder.select = vi.fn(() => builder)
    builder.in = vi.fn(() => {
      usedIn = true
      return builder
    })
    builder.order = vi.fn(() => builder)
    builder.limit = vi.fn(() => builder)
    builder.then = (
      onFulfilled: (value: MockResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(usedIn ? sameTagResult : dbWideResult).then(onFulfilled, onRejected)
    return builder
  }
}

describe('generateVocabBatch', () => {
  it('creates a batch, includes both same-tag and DB-wide existing words as dedup context, and stores pending items', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-2' }, error: null })
      if (table === 'vocab_tags') return makeQueryBuilder({ data: { id: 1 }, error: null })
      if (table === 'vocab_word_tags') return makeQueryBuilder({ data: [{ vocab_word_id: 'w-1' }], error: null })
      if (table === 'vocab_words') {
        return makeVocabWordsRouter(
          { data: [{ word: 'negotiate' }], error: null }, // DB全体（直近100件）
          { data: [{ word: 'itinerary' }], error: null }, // 同一タグ（直近50件）
        )()
      }
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
    const generateJsonArray = vi.fn().mockResolvedValue({ items: geminiItems, truncated: false, parseRecovered: false })

    const result = await generateVocabBatch(
      { tagName: 'ビジネス', count: 1, targetBand: 730 },
      { supabase, generateJsonArray },
    )

    expect(result).toEqual({ batchId: 'batch-2', itemCount: 1, truncated: false })

    const promptArg = generateJsonArray.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('【テーマ】\nビジネス')
    expect(promptArg).toContain('- negotiate') // DB全体サンプル由来
    expect(promptArg).toContain('- itinerary') // 同一タグサンプル由来

    // --modelを指定しない場合、.env(env.GEMINI_MODEL)の値がそのままモデル名として使われること
    expect(generateJsonArray.mock.calls[0][0].model).toBe('gemini-test-model')

    const itemsBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batch_items',
    )!.value
    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { batch_id: 'batch-2', raw_payload: geminiItems[0], status: 'pending_validation' },
    ])
  })

  it('includes a same-tag word even when it falls outside the DB-wide recent sample (2026-08-12 regression test)', async () => {
    // 実データで確認した事例の再現: negotiateがDB全体では古い(直近100件に入らない)が、
    // ビジネスタグ自身の直近50件には含まれる、というケース。
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-old' }, error: null })
      if (table === 'vocab_tags') return makeQueryBuilder({ data: { id: 1 }, error: null })
      if (table === 'vocab_word_tags') return makeQueryBuilder({ data: [{ vocab_word_id: 'w-negotiate' }], error: null })
      if (table === 'vocab_words') {
        return makeVocabWordsRouter(
          { data: [{ word: 'recent-other-tag-word' }], error: null }, // DB全体にはnegotiateは含まれない
          { data: [{ word: 'negotiate' }], error: null }, // 同一タグには含まれる
        )()
      }
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']
    const generateJsonArray = vi.fn().mockResolvedValue({ items: [], truncated: false, parseRecovered: false })

    await generateVocabBatch({ tagName: 'ビジネス', count: 1, targetBand: 730 }, { supabase, generateJsonArray })

    const promptArg = generateJsonArray.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('- negotiate')
    expect(promptArg).toContain('- recent-other-tag-word')
  })

  it('uses an empty dedup list when there are no existing vocab_words yet (new tag)', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-3' }, error: null })
      if (table === 'vocab_tags') return makeQueryBuilder({ data: null, error: null }) // タグ自体がまだ無い
      if (table === 'vocab_words') return makeQueryBuilder({ data: [], error: null }) // DB全体クエリのみ発生
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']
    const generateJsonArray = vi.fn().mockResolvedValue({ items: [], truncated: false, parseRecovered: false })

    const result = await generateVocabBatch(
      { tagName: '新テーマ', count: 1, targetBand: 600 },
      { supabase, generateJsonArray },
    )

    expect(result).toEqual({ batchId: 'batch-3', itemCount: 0, truncated: false })
    const promptArg = generateJsonArray.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('（なし）')
  })

  it('records a note on generation_batches when the Gemini output was truncated (10.6)', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-trunc' }, error: null })
      if (table === 'vocab_tags') return makeQueryBuilder({ data: null, error: null })
      if (table === 'vocab_words') return makeQueryBuilder({ data: [], error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']
    const generateJsonArray = vi.fn().mockResolvedValue({ items: [], truncated: true, parseRecovered: true })

    const result = await generateVocabBatch(
      { tagName: 'ビジネス', count: 8, targetBand: 730 },
      { supabase, generateJsonArray },
    )

    expect(result).toEqual({ batchId: 'batch-trunc', itemCount: 0, truncated: true })
    const batchesCalls = fromMock.mock.calls
      .map((call, i) => ({ call, result: fromMock.mock.results[i].value }))
      .filter((c) => c.call[0] === 'generation_batches')
    const updateBuilder = batchesCalls[batchesCalls.length - 1].result
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ notes: expect.stringContaining('依頼8件中0件のみ生成・保存') }),
    )
  })

  it('throws when tagName is omitted and contentKind is the default "vocab"', async () => {
    const supabase = { from: vi.fn() } as unknown as Parameters<typeof generateVocabBatch>[1]['supabase']
    const generateJsonArray = vi.fn()
    await expect(
      generateVocabBatch({ count: 1, targetBand: 600 }, { supabase, generateJsonArray }),
    ).rejects.toThrow('tagName は必須です')
    expect(generateJsonArray).not.toHaveBeenCalled()
  })

  describe('contentKind="idiom" (13.2)', () => {
    it('ignores tagName, uses same-tag + DB-wide dedup context under IDIOM_TAG_NAME, and builds the idiom prompt', async () => {
      const fromMock = vi.fn((table: string) => {
        if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-4' }, error: null })
        if (table === 'vocab_tags') return makeQueryBuilder({ data: { id: 9 }, error: null })
        if (table === 'vocab_word_tags') return makeQueryBuilder({ data: [{ vocab_word_id: 'w-idiom' }], error: null })
        if (table === 'vocab_words') {
          return makeVocabWordsRouter(
            { data: [], error: null },
            { data: [{ word: 'get the ball rolling' }], error: null },
          )()
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
      const generateJsonArray = vi.fn().mockResolvedValue({ items: geminiItems, truncated: false, parseRecovered: false })

      const result = await generateVocabBatch(
        { contentKind: 'idiom', count: 1, targetBand: 730 },
        { supabase, generateJsonArray },
      )

      expect(result).toEqual({ batchId: 'batch-4', itemCount: 1, truncated: false })

      // IDIOM_TAG_NAMEでタグ解決が行われたこと
      const tagsBuilder = fromMock.mock.results.find((_r, i) => fromMock.mock.calls[i][0] === 'vocab_tags')!
        .value as Record<string, ReturnType<typeof vi.fn>>
      expect(tagsBuilder.eq).toHaveBeenCalledWith('name', IDIOM_TAG_NAME)

      const promptArg = generateJsonArray.mock.calls[0][0].prompt as string
      expect(promptArg).toContain('イディオム（慣用表現）')
      expect(promptArg).toContain('- get the ball rolling')
      expect(promptArg).not.toContain('【テーマ】') // vocab.md固有の見出しは含まれない
    })
  })
})

describe('generateVocabBatchFromWordlist (21.5)', () => {
  it('creates a batch, uses only DB-wide existing words as dedup context, and stores pending items', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-wl-1' }, error: null })
      if (table === 'vocab_words') return makeQueryBuilder({ data: [{ word: 'negotiate' }], error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatchFromWordlist>[1]['supabase']

    const geminiItems = [
      {
        word: 'abandon',
        part_of_speech: 'verb',
        meaning_ja: '放棄する',
        example_sentence_en: 'The company decided to abandon the project.',
        example_sentence_ja: '会社はそのプロジェクトを放棄することにした。',
        toeic_band: 600,
        etymology_note: 'a-(〜に)+bandon(支配)→「支配下に置く」→そこから「委ねる、放棄する」',
        tags: ['ビジネス'],
      },
    ]
    const generateJsonArray = vi.fn().mockResolvedValue({ items: geminiItems, truncated: false, parseRecovered: false })

    const result = await generateVocabBatchFromWordlist(
      { words: [{ word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' }], targetBand: 600 },
      { supabase, generateJsonArray },
    )

    expect(result).toEqual({ batchId: 'batch-wl-1', itemCount: 1, truncated: false })

    // vocab_tags/vocab_word_tagsは(単一タグに紐づかないため)問い合わせない
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual([
      'generation_batches',
      'vocab_words',
      'generation_batch_items',
      'generation_batches',
    ])

    const promptArg = generateJsonArray.mock.calls[0][0].prompt as string
    expect(promptArg).toContain('- abandon (verb, CEFR B1)')
    expect(promptArg).toContain('- negotiate')
    expect(promptArg).toContain('TOEIC目安 600点前後')

    const itemsBuilder = fromMock.mock.results.find(
      (_r, i) => fromMock.mock.calls[i][0] === 'generation_batch_items',
    )!.value
    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { batch_id: 'batch-wl-1', raw_payload: geminiItems[0], status: 'pending_validation' },
    ])
  })

  it('throws without calling Gemini when words is empty', async () => {
    const supabase = { from: vi.fn() } as unknown as Parameters<typeof generateVocabBatchFromWordlist>[1]['supabase']
    const generateJsonArray = vi.fn()

    await expect(
      generateVocabBatchFromWordlist({ words: [], targetBand: 600 }, { supabase, generateJsonArray }),
    ).rejects.toThrow('words は1件以上必要です')
    expect(generateJsonArray).not.toHaveBeenCalled()
  })

  it('records a note on generation_batches when the Gemini output was truncated (10.6)', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'generation_batches') return makeQueryBuilder({ data: { id: 'batch-wl-trunc' }, error: null })
      if (table === 'vocab_words') return makeQueryBuilder({ data: [], error: null })
      if (table === 'generation_batch_items') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof generateVocabBatchFromWordlist>[1]['supabase']
    const generateJsonArray = vi.fn().mockResolvedValue({ items: [], truncated: true, parseRecovered: false })

    const result = await generateVocabBatchFromWordlist(
      {
        words: [
          { word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' },
          { word: 'able', partOfSpeech: 'adjective', cefrLevel: 'B1' },
        ],
        targetBand: 600,
      },
      { supabase, generateJsonArray },
    )

    expect(result).toEqual({ batchId: 'batch-wl-trunc', itemCount: 0, truncated: true })
    const batchesCalls = fromMock.mock.calls
      .map((call, i) => ({ call, result: fromMock.mock.results[i].value }))
      .filter((c) => c.call[0] === 'generation_batches')
    const updateBuilder = batchesCalls[batchesCalls.length - 1].result
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ notes: expect.stringContaining('依頼2件中0件のみ生成・保存') }),
    )
  })
})
