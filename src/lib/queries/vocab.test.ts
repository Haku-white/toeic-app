import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VocabProgressState } from '../fsrs'
import type { VocabProgressStats } from './vocab'

// `../supabase` はネットワークに接続する実クライアントなので、テーブルごとに
// チェーン可能・awaitable なクエリビルダのモックへ差し替える。
type MockResult = { data: unknown; error: unknown; count?: number | null }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.lte = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.limit = vi.fn(chain)
  builder.in = vi.fn(chain)
  builder.not = vi.fn(chain)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.upsert = vi.fn(() => Promise.resolve(result))
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

const { applySessionTransitions, getDueVocabCards, getVocabProgressStats, getVocabTagByCode, getVocabTags, submitVocabReview } =
  await import('./vocab')

beforeEach(() => {
  fromMock.mockReset()
})

describe('getDueVocabCards', () => {
  it('returns due-review cards joined with word content', async () => {
    const dueProgressRow = {
      vocab_word_id: 'word-1',
      state: 'review',
      due_at: '2026-08-01T00:00:00.000Z',
      stability: 5,
      difficulty: 3,
      elapsed_days: 4,
      scheduled_days: 4,
      reps: 3,
      lapses: 0,
      last_review_at: '2026-08-05T00:00:00.000Z',
    }
    const wordRow = {
      id: 'word-1',
      word: 'negotiate',
      part_of_speech: 'verb',
      meaning_ja: '交渉する',
      example_sentence_en: 'We need to negotiate the contract terms.',
      example_sentence_ja: '契約条件について交渉する必要がある。',
    }

    let progressCallCount = 0
    fromMock.mockImplementation((table: string) => {
      if (table === 'user_vocab_progress') {
        progressCallCount += 1
        // 1回目: due一覧(1件) 2回目: 除外対象を洗い出すための全件取得(同じ1件)
        return makeQueryBuilder({ data: [dueProgressRow], error: null })
      }
      if (table === 'vocab_words') {
        // 1回目: dueの単語本体 2回目: 新規カード探索(枠は埋まっているので0件でよい)
        return makeQueryBuilder({ data: progressCallCount <= 1 ? [wordRow] : [], error: null })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const cards = await getDueVocabCards('user-1', 20)

    expect(cards).toHaveLength(1)
    expect(cards[0].vocabWordId).toBe('word-1')
    expect(cards[0].word).toBe('negotiate')
    expect(cards[0].progress?.state).toBe('review')
    expect(cards[0].progress?.reps).toBe(3)
  })

  it('fills remaining slots with new (progress-less) words, excluding already-seen ids', async () => {
    let progressCallCount = 0
    const newWordRow = {
      id: 'word-2',
      word: 'reimburse',
      part_of_speech: 'verb',
      meaning_ja: '払い戻す',
      example_sentence_en: 'The company will reimburse your travel expenses.',
      example_sentence_ja: '会社が旅費を払い戻します。',
    }

    fromMock.mockImplementation((table: string) => {
      if (table === 'user_vocab_progress') {
        progressCallCount += 1
        // 1回目: due一覧は0件。2回目: 既存進捗(除外対象)としてword-1を返す
        if (progressCallCount === 1) return makeQueryBuilder({ data: [], error: null })
        return makeQueryBuilder({ data: [{ vocab_word_id: 'word-1' }], error: null })
      }
      if (table === 'vocab_words') {
        return makeQueryBuilder({ data: [newWordRow], error: null })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const cards = await getDueVocabCards('user-1', 20)

    expect(cards).toHaveLength(1)
    expect(cards[0].vocabWordId).toBe('word-2')
    expect(cards[0].progress).toBeNull()
  })

  it('throws when a query returns an error', async () => {
    fromMock.mockImplementation(() =>
      makeQueryBuilder({ data: null, error: new Error('boom') }),
    )
    await expect(getDueVocabCards('user-1', 20)).rejects.toThrow('boom')
  })

  it('resolves tagCode (vocab_tags.code) to its word ids before scoping the due/new-card queries', async () => {
    const businessWord = {
      id: 'word-1',
      word: 'negotiate',
      part_of_speech: 'verb',
      meaning_ja: '交渉する',
      example_sentence_en: 'We need to negotiate.',
      example_sentence_ja: null,
      etymology_note: null,
    }

    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_tags') return makeQueryBuilder({ data: { id: 5, name: 'ビジネス' }, error: null })
      if (table === 'vocab_word_tags') {
        return makeQueryBuilder({ data: [{ vocab_word_id: 'word-1' }], error: null })
      }
      if (table === 'user_vocab_progress') return makeQueryBuilder({ data: [], error: null })
      if (table === 'vocab_words') return makeQueryBuilder({ data: [businessWord], error: null })
      throw new Error(`unexpected table: ${table}`)
    })

    const cards = await getDueVocabCards('user-1', 20, 'business')

    expect(fromMock.mock.calls.map((call) => call[0])).toEqual([
      'vocab_tags',
      'vocab_word_tags',
      'user_vocab_progress', // due一覧(0件)
      'user_vocab_progress', // 除外対象の全件取得
      'vocab_words', // 新規カード
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].vocabWordId).toBe('word-1')
  })

  it('returns an empty array immediately when the tag has no words, without querying progress/words', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_tags') return makeQueryBuilder({ data: { id: 5 }, error: null })
      if (table === 'vocab_word_tags') return makeQueryBuilder({ data: [], error: null })
      throw new Error(`unexpected table queried: ${table}`)
    })

    const cards = await getDueVocabCards('user-1', 20, 'empty-tag')

    expect(cards).toEqual([])
    expect(fromMock).toHaveBeenCalledTimes(2)
  })

  it('returns an empty array when tagCode does not match any vocab_tags row', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_tags') return makeQueryBuilder({ data: null, error: null })
      throw new Error(`unexpected table queried: ${table}`)
    })

    const cards = await getDueVocabCards('user-1', 20, 'unknown-code')

    expect(cards).toEqual([])
    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})

describe('getVocabTagByCode', () => {
  it('resolves a vocab_tags row by code', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_tags') return makeQueryBuilder({ data: { id: 1, name: 'ビジネス' }, error: null })
      throw new Error(`unexpected table: ${table}`)
    })

    const tag = await getVocabTagByCode('business')
    expect(tag).toEqual({ id: 1, name: 'ビジネス' })
  })

  it('returns null when no tag matches the code', async () => {
    fromMock.mockImplementation(() => makeQueryBuilder({ data: null, error: null }))
    expect(await getVocabTagByCode('unknown-code')).toBeNull()
  })
})

describe('getVocabTags', () => {
  it('fetches all tags ordered by name, excluding code, id, name only', async () => {
    const notMock = vi.fn(() => builderWithOrder)
    const orderMock = vi.fn(() =>
      Promise.resolve({
        data: [
          { id: 1, code: 'business', name: 'ビジネス' },
          { id: 2, code: 'daily_conversation', name: '日常会話' },
        ],
        error: null,
      }),
    )
    const builderWithOrder = { order: orderMock }
    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_tags') return { select: vi.fn(() => ({ not: notMock })) }
      throw new Error(`unexpected table: ${table}`)
    })

    const tags = await getVocabTags()

    expect(notMock).toHaveBeenCalledWith('code', 'is', null)
    expect(orderMock).toHaveBeenCalledWith('name', { ascending: true })
    expect(tags).toEqual([
      { id: 1, code: 'business', name: 'ビジネス' },
      { id: 2, code: 'daily_conversation', name: '日常会話' },
    ])
  })

  it('throws when the query returns an error', async () => {
    fromMock.mockImplementation(() => makeQueryBuilder({ data: null, error: new Error('boom') }))
    await expect(getVocabTags()).rejects.toThrow('boom')
  })
})

describe('submitVocabReview', () => {
  it('upserts user_vocab_progress and inserts vocab_review_logs with matching computed state', async () => {
    const upsertSpy = vi.fn((_payload: Record<string, unknown>, _options: Record<string, unknown>) =>
      Promise.resolve({ data: null, error: null }),
    )
    const insertSpy = vi.fn((_payload: Record<string, unknown>) => Promise.resolve({ data: null, error: null }))

    fromMock.mockImplementation((table: string) => {
      if (table === 'user_vocab_progress') return { upsert: upsertSpy }
      if (table === 'vocab_review_logs') return { insert: insertSpy }
      throw new Error(`unexpected table: ${table}`)
    })

    const currentProgress: VocabProgressState = {
      state: 'review',
      dueAt: '2026-08-01T00:00:00.000Z',
      stability: 5,
      difficulty: 3,
      elapsedDays: 4,
      scheduledDays: 4,
      reps: 3,
      lapses: 0,
      lastReviewAt: '2026-07-28T00:00:00.000Z',
    }

    const result = await submitVocabReview({
      userId: 'user-1',
      vocabWordId: 'word-1',
      currentProgress,
      rating: 'good',
      responseTimeMs: 2500,
    })

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [upsertPayload, upsertOptions] = upsertSpy.mock.calls[0]
    expect(upsertPayload).toMatchObject({ user_id: 'user-1', vocab_word_id: 'word-1', state: result.state })
    expect(upsertOptions).toEqual({ onConflict: 'user_id,vocab_word_id' })

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const [insertPayload] = insertSpy.mock.calls[0]
    expect(insertPayload).toMatchObject({
      user_id: 'user-1',
      vocab_word_id: 'word-1',
      rating: 'good',
      response_time_ms: 2500,
    })
  })

  it('throws and does not insert a review log when the progress upsert fails', async () => {
    const upsertSpy = vi.fn(() => Promise.resolve({ data: null, error: new Error('rls denied') }))
    const insertSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))

    fromMock.mockImplementation((table: string) => {
      if (table === 'user_vocab_progress') return { upsert: upsertSpy }
      if (table === 'vocab_review_logs') return { insert: insertSpy }
      throw new Error(`unexpected table: ${table}`)
    })

    await expect(
      submitVocabReview({
        userId: 'user-1',
        vocabWordId: 'word-1',
        currentProgress: null,
        rating: 'again',
      }),
    ).rejects.toThrow('rls denied')

    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe('getVocabProgressStats', () => {
  it('aggregates state counts, due count, and average stability from user_vocab_progress', async () => {
    const pastIso = new Date(Date.now() - 86400000).toISOString()
    const futureIso = new Date(Date.now() + 86400000).toISOString()

    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_words') return makeQueryBuilder({ data: null, error: null, count: 10 })
      if (table === 'user_vocab_progress') {
        return makeQueryBuilder({
          data: [
            { state: 'learning', stability: 2, due_at: futureIso },
            { state: 'review', stability: 8, due_at: pastIso },
            { state: 'review', stability: 12, due_at: futureIso },
            { state: 'relearning', stability: 1, due_at: pastIso },
          ],
          error: null,
        })
      }
      throw new Error(`unexpected table: ${table}`)
    })

    const stats = await getVocabProgressStats('user-1')

    expect(stats).toEqual({
      totalWords: 10,
      newCount: 6,
      learningCount: 1,
      reviewCount: 2,
      relearningCount: 1,
      dueCount: 2,
      averageStability: (2 + 8 + 12 + 1) / 4,
    })
  })

  it('returns zeroed stats when the user has no progress rows yet', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_words') return makeQueryBuilder({ data: null, error: null, count: 5 })
      if (table === 'user_vocab_progress') return makeQueryBuilder({ data: [], error: null })
      throw new Error(`unexpected table: ${table}`)
    })

    const stats = await getVocabProgressStats('user-1')

    expect(stats).toEqual({
      totalWords: 5,
      newCount: 5,
      learningCount: 0,
      reviewCount: 0,
      relearningCount: 0,
      dueCount: 0,
      averageStability: 0,
    })
  })

  it('throws when the word-count query fails', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_words') return makeQueryBuilder({ data: null, error: new Error('boom'), count: null })
      return makeQueryBuilder({ data: [], error: null })
    })
    await expect(getVocabProgressStats('user-1')).rejects.toThrow('boom')
  })

  it('throws when the progress query fails', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'vocab_words') return makeQueryBuilder({ data: null, error: null, count: 10 })
      return makeQueryBuilder({ data: null, error: new Error('rls denied') })
    })
    await expect(getVocabProgressStats('user-1')).rejects.toThrow('rls denied')
  })
})

describe('applySessionTransitions', () => {
  const baseline: VocabProgressStats = {
    totalWords: 10,
    newCount: 6,
    learningCount: 1,
    reviewCount: 2,
    relearningCount: 1,
    dueCount: 2,
    averageStability: 5.75, // (2+8+12+1)/4、startedCount=4
  }

  it('returns the baseline unchanged when there are no transitions', () => {
    expect(applySessionTransitions(baseline, [])).toEqual(baseline)
  })

  it('moves a brand-new word out of the New bucket and recalculates average stability', () => {
    const now = new Date('2026-08-13T00:00:00.000Z')
    const after: VocabProgressState = {
      state: 'learning',
      dueAt: '2026-08-14T00:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      lastReviewAt: now.toISOString(),
    }

    const result = applySessionTransitions(baseline, [{ before: null, after }], now)

    expect(result.newCount).toBe(5)
    expect(result.learningCount).toBe(2)
    expect(result.dueCount).toBe(2) // 着手前がnullのため期日到来数には影響しない
    expect(result.averageStability).toBeCloseTo(24 / 5) // (23+1)/(4+1)
  })

  it('moves a due review card into relearning and removes it from the due count', () => {
    const now = new Date('2026-08-13T00:00:00.000Z')
    const before: VocabProgressState = {
      state: 'review',
      dueAt: '2026-08-12T00:00:00.000Z', // nowより過去=期日到来済み
      stability: 8,
      difficulty: 5,
      elapsedDays: 5,
      scheduledDays: 5,
      reps: 3,
      lapses: 0,
      lastReviewAt: '2026-08-08T00:00:00.000Z',
    }
    const after: VocabProgressState = {
      state: 'relearning',
      dueAt: '2026-08-13T00:10:00.000Z',
      stability: 1,
      difficulty: 6,
      elapsedDays: 5,
      scheduledDays: 0.1,
      reps: 4,
      lapses: 1,
      lastReviewAt: now.toISOString(),
    }

    const result = applySessionTransitions(baseline, [{ before, after }], now)

    expect(result.reviewCount).toBe(1)
    expect(result.relearningCount).toBe(2)
    expect(result.dueCount).toBe(1) // 期日到来済みだったカードが再スケジュールされ、除外された
    expect(result.averageStability).toBeCloseTo(4) // (23-8+1)/4、startedCountは変化なし
  })
})
