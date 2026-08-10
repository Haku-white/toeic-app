import { describe, expect, it, vi } from 'vitest'
import { commitBatch } from './commitBatch'

type MockResult = { data: unknown; error: unknown; count?: number }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.in = vi.fn(chain)
  builder.not = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.upsert = vi.fn(() => builder)
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

/** 同じテーブルへの複数回の`.from()`呼び出しに対して、順番にcannedな結果を返すディスパッチャ */
function makeDispatcher(results: MockResult[]) {
  let index = 0
  return () => {
    const result = results[index] ?? { data: null, error: null }
    index += 1
    return makeQueryBuilder(result)
  }
}

describe('commitBatch (grammar)', () => {
  it('commits auto_passed items into grammar_questions, caching the category lookup, and marks the batch completed', async () => {
    const grammarItem = (categoryCode: string) => ({
      question_text: `Q ${categoryCode}`,
      choices: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'exp',
      difficulty: 2,
      category_code: categoryCode,
    })

    const itemsDispatch = makeDispatcher([
      {
        data: [
          { id: 'item-1', raw_payload: grammarItem('tense') },
          { id: 'item-2', raw_payload: grammarItem('tense') },
        ],
        error: null,
      }, // 1: select auto_passed/approved items
      { data: null, error: null }, // 2: item-1 update -> committed
      { data: null, error: null }, // 3: item-2 update -> committed
      { data: null, error: null, count: 2 }, // 4: committed count
      { data: null, error: null, count: 0 }, // 5: needs_review count
      { data: null, error: null, count: 0 }, // 6: rejected count
      { data: null, error: null, count: 0 }, // 7: remaining count
    ])

    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'grammar' }, error: null }, // select content_type
      { data: null, error: null }, // final aggregate update
    ])

    const categoriesDispatch = makeDispatcher([{ data: { id: 7 }, error: null }])
    const questionsDispatch = makeDispatcher([
      { data: { id: 'question-1' }, error: null },
      { data: { id: 'question-2' }, error: null },
    ])

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'grammar_categories') return categoriesDispatch()
      if (table === 'grammar_questions') return questionsDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const result = await commitBatch('batch-1', { supabase })

    expect(result).toEqual({ committedCount: 2, failedCount: 0 })
    expect(from.mock.calls.filter((c) => c[0] === 'grammar_categories')).toHaveLength(1) // キャッシュされている
    expect(from.mock.calls.filter((c) => c[0] === 'grammar_questions')).toHaveLength(2)
  })

  it('resolves category_code case-insensitively (実データでGeminiが"SUBJUNCTIVE"のように大文字化して出力したケースを再現)', async () => {
    const grammarItem = {
      question_text: 'Q',
      choices: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'exp',
      difficulty: 2,
      category_code: 'TENSE',
    }

    const itemsDispatch = makeDispatcher([
      { data: [{ id: 'item-1', raw_payload: grammarItem }], error: null },
      { data: null, error: null }, // item-1 update -> committed
      { data: null, error: null, count: 1 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
    ])
    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'grammar' }, error: null },
      { data: null, error: null },
    ])

    let categoryEqArgs: unknown[] = []
    const categoriesBuilder = makeQueryBuilder({ data: { id: 3 }, error: null })
    categoriesBuilder.eq = vi.fn((...args: unknown[]) => {
      categoryEqArgs = args
      return categoriesBuilder
    })

    const questionsDispatch = makeDispatcher([{ data: { id: 'question-1' }, error: null }])

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'grammar_categories') return categoriesBuilder
      if (table === 'grammar_questions') return questionsDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const result = await commitBatch('batch-x', { supabase })

    expect(result).toEqual({ committedCount: 1, failedCount: 0 })
    expect(categoryEqArgs).toEqual(['code', 'tense'])
  })

  it('keeps the batch in needs_review status and does not insert a row when an item commit fails', async () => {
    const badItem = {
      // category_code が完全一致もfallbackの前方一致もしない想定
      question_text: 'Q',
      choices: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'exp',
      difficulty: 2,
      category_code: 'unknown-category',
    }

    const needsReviewBuilder = makeQueryBuilder({ data: null, error: null })
    const itemBuilders = [
      makeQueryBuilder({ data: [{ id: 'item-1', raw_payload: badItem }], error: null }), // select
      needsReviewBuilder, // item-1 -> needs_review (catch path)
      makeQueryBuilder({ data: null, error: null, count: 0 }), // committed count
      makeQueryBuilder({ data: null, error: null, count: 1 }), // needs_review count
      makeQueryBuilder({ data: null, error: null, count: 0 }), // rejected count
      makeQueryBuilder({ data: null, error: null, count: 1 }), // remaining count (1 => not completed)
    ]
    let itemCallIndex = 0
    const itemsDispatch = () => itemBuilders[itemCallIndex++]

    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'grammar' }, error: null },
      { data: null, error: null },
    ])
    // 1: 完全一致(maybeSingle)がヒットなし / 2: fallbackの全件取得も前方一致なし
    const categoriesDispatch = makeDispatcher([
      { data: null, error: null },
      { data: [{ id: 1, code: 'tense' }, { id: 7, code: 'conjunction' }], error: null },
    ])

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'grammar_categories') return categoriesDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await commitBatch('batch-2', { supabase })
    consoleErrorSpy.mockRestore()

    expect(result).toEqual({ committedCount: 0, failedCount: 1 })

    // 更新されたvalidation_errorsが"[object Object]"のような非情報的な文字列になっていないこと
    const updateArg = (needsReviewBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      validation_errors: string[]
    }
    expect(updateArg.validation_errors[0]).toContain('unknown-category')
    expect(updateArg.validation_errors[0]).not.toContain('[object Object]')
  })

  it('resolves an abbreviated category_code via the prefix-match fallback (実データでGeminiが"comparison"を"COMP"のように省略して出力したケースを再現)', async () => {
    const grammarItem = {
      question_text: 'Q',
      choices: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'exp',
      difficulty: 2,
      category_code: 'COMP',
    }

    const itemsDispatch = makeDispatcher([
      { data: [{ id: 'item-1', raw_payload: grammarItem }], error: null },
      { data: null, error: null }, // item-1 update -> committed
      { data: null, error: null, count: 1 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
    ])
    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'grammar' }, error: null },
      { data: null, error: null },
    ])
    // 1: 完全一致(maybeSingle)がヒットなし / 2: fallbackの全件取得で"comp"が"comparison"の前方一致として解決
    const categoriesDispatch = makeDispatcher([
      { data: null, error: null },
      {
        data: [
          { id: 1, code: 'tense' },
          { id: 8, code: 'comparison' },
        ],
        error: null,
      },
    ])
    const questionsDispatch = makeDispatcher([{ data: { id: 'question-1' }, error: null }])

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'grammar_categories') return categoriesDispatch()
      if (table === 'grammar_questions') return questionsDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const result = await commitBatch('batch-comp', { supabase })

    expect(result).toEqual({ committedCount: 1, failedCount: 0 })
  })

  it('throws (and falls back the item to needs_review) when the fallback prefix-match is ambiguous', async () => {
    const grammarItem = {
      question_text: 'Q',
      choices: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'exp',
      difficulty: 2,
      category_code: 'co', // 'comparison'にも仮想の'conjunction'にも前方一致しうる曖昧なコード
    }

    const itemsDispatch = makeDispatcher([
      { data: [{ id: 'item-1', raw_payload: grammarItem }], error: null },
      { data: null, error: null }, // item-1 -> needs_review (catch path)
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 1 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 1 },
    ])
    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'grammar' }, error: null },
      { data: null, error: null },
    ])
    const categoriesDispatch = makeDispatcher([
      { data: null, error: null },
      {
        data: [
          { id: 7, code: 'conjunction' },
          { id: 8, code: 'comparison' },
        ],
        error: null,
      },
    ])

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'grammar_categories') return categoriesDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await commitBatch('batch-ambiguous', { supabase })
    consoleErrorSpy.mockRestore()

    expect(result).toEqual({ committedCount: 0, failedCount: 1 })
  })
})

describe('commitBatch (vocab)', () => {
  it('commits an item into vocab_words and creates a new tag with its code resolved from VOCAB_TAG_CODES (16.3)', async () => {
    const vocabItem = {
      word: 'negotiate',
      part_of_speech: 'verb',
      meaning_ja: '交渉する',
      example_sentence_en: 'We negotiate.',
      example_sentence_ja: '交渉する。',
      toeic_band: 730,
      etymology_note: 'note',
      tags: ['ビジネス'],
    }

    const itemsDispatch = makeDispatcher([
      { data: [{ id: 'item-1', raw_payload: vocabItem }], error: null },
      { data: null, error: null }, // item update -> committed
      { data: null, error: null, count: 1 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
    ])
    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'vocab' }, error: null },
      { data: null, error: null },
    ])
    const wordsDispatch = makeDispatcher([{ data: { id: 'word-1' }, error: null }])
    // 1: select by name -> 未作成(null) / 2: code付きでinsert -> {id:9}
    const tagsDispatch = makeDispatcher([
      { data: null, error: null },
      { data: { id: 9 }, error: null },
    ])
    const wordTagsDispatch = makeDispatcher([{ data: null, error: null }])

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'vocab_words') return wordsDispatch()
      if (table === 'vocab_tags') return tagsDispatch()
      if (table === 'vocab_word_tags') return wordTagsDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const result = await commitBatch('batch-3', { supabase })

    expect(result).toEqual({ committedCount: 1, failedCount: 0 })
    expect(from.mock.calls.filter((c) => c[0] === 'vocab_tags')).toHaveLength(2) // select + insert
    expect(from.mock.calls.filter((c) => c[0] === 'vocab_word_tags')).toHaveLength(1)
  })

  it('reuses an existing tag id without inserting when the tag name already exists', async () => {
    const vocabItem = {
      word: 'negotiate',
      part_of_speech: 'verb',
      meaning_ja: '交渉する',
      example_sentence_en: 'We negotiate.',
      example_sentence_ja: '交渉する。',
      toeic_band: 730,
      etymology_note: 'note',
      tags: ['ビジネス'],
    }

    const itemsDispatch = makeDispatcher([
      { data: [{ id: 'item-1', raw_payload: vocabItem }], error: null },
      { data: null, error: null },
      { data: null, error: null, count: 1 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
    ])
    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'vocab' }, error: null },
      { data: null, error: null },
    ])
    const wordsDispatch = makeDispatcher([{ data: { id: 'word-1' }, error: null }])
    const tagsDispatch = makeDispatcher([{ data: { id: 1 }, error: null }]) // 既存タグが1回のselectで見つかる
    const wordTagsDispatch = makeDispatcher([{ data: null, error: null }])

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'vocab_words') return wordsDispatch()
      if (table === 'vocab_tags') return tagsDispatch()
      if (table === 'vocab_word_tags') return wordTagsDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const result = await commitBatch('batch-4', { supabase })

    expect(result).toEqual({ committedCount: 1, failedCount: 0 })
    expect(from.mock.calls.filter((c) => c[0] === 'vocab_tags')).toHaveLength(1) // selectのみ、insertなし
  })

  it('falls back an item to needs_review when a new tag name is not registered in VOCAB_TAG_CODES', async () => {
    const vocabItem = {
      word: 'mystery',
      part_of_speech: 'noun',
      meaning_ja: '謎',
      example_sentence_en: 'It is a mystery.',
      example_sentence_ja: 'それは謎だ。',
      toeic_band: 730,
      etymology_note: 'note',
      tags: ['未登録タグ'],
    }

    const itemsDispatch = makeDispatcher([
      { data: [{ id: 'item-1', raw_payload: vocabItem }], error: null },
      { data: null, error: null }, // item-1 -> needs_review (catch path)
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 1 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 1 },
    ])
    const batchesDispatch = makeDispatcher([
      { data: { content_type: 'vocab' }, error: null },
      { data: null, error: null },
    ])
    const wordsDispatch = makeDispatcher([{ data: { id: 'word-1' }, error: null }])
    const tagsDispatch = makeDispatcher([{ data: null, error: null }]) // 未作成タグ(select miss)

    const from = vi.fn((table: string) => {
      if (table === 'generation_batches') return batchesDispatch()
      if (table === 'generation_batch_items') return itemsDispatch()
      if (table === 'vocab_words') return wordsDispatch()
      if (table === 'vocab_tags') return tagsDispatch()
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from } as unknown as Parameters<typeof commitBatch>[1]['supabase']

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await commitBatch('batch-5', { supabase })
    consoleErrorSpy.mockRestore()

    expect(result).toEqual({ committedCount: 0, failedCount: 1 })
  })
})
