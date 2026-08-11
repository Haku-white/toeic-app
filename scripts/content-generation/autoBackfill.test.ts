import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@google/genai'

const checkGrammarInventoryMock = vi.fn()
const checkVocabInventoryMock = vi.fn()
vi.mock('./inventoryCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inventoryCheck')>()
  return { ...actual, checkGrammarInventory: checkGrammarInventoryMock, checkVocabInventory: checkVocabInventoryMock }
})

const generateGrammarBatchMock = vi.fn()
vi.mock('./generateGrammar', () => ({ generateGrammarBatch: generateGrammarBatchMock }))

const generateVocabBatchMock = vi.fn()
vi.mock('./generateVocab', () => ({ generateVocabBatch: generateVocabBatchMock, IDIOM_TAG_NAME: 'イディオム' }))

const validateBatchMock = vi.fn()
vi.mock('./validateBatch', () => ({ validateBatch: validateBatchMock }))

const commitBatchMock = vi.fn()
vi.mock('./commitBatch', () => ({ commitBatch: commitBatchMock }))

const { runAutoBackfill, distributeGrammarShortfall, chunkCount } = await import('./autoBackfill')

const immediatePool = { run: <T>(task: () => Promise<T>) => task() }
const fakeDeps = {
  supabase: {} as never,
  generateJsonArray: vi.fn() as never,
  generateJson: vi.fn() as never,
  pool: immediatePool,
}

beforeEach(() => {
  checkGrammarInventoryMock.mockReset().mockResolvedValue([])
  checkVocabInventoryMock.mockReset().mockResolvedValue([])
  generateGrammarBatchMock.mockReset()
  generateVocabBatchMock.mockReset()
  validateBatchMock.mockReset().mockResolvedValue({ total: 0, autoPassed: 0, needsReview: 0, totalItemsInBatch: 0 })
  commitBatchMock.mockReset().mockResolvedValue({ committedCount: 0, failedCount: 0 })
})

describe('distributeGrammarShortfall (10.4: 難易度3:4:5への按分)', () => {
  it('splits evenly divisible shortfalls exactly along the 3:3:2 weight ratio', () => {
    expect(distributeGrammarShortfall(8)).toEqual([
      { difficulty: 3, count: 3 },
      { difficulty: 4, count: 3 },
      { difficulty: 5, count: 2 },
    ])
  })

  it('distributes remainder fractions (largest-remainder-first) so the total always matches the shortfall', () => {
    const tiers = distributeGrammarShortfall(10)
    expect(tiers.reduce((sum, t) => sum + t.count, 0)).toBe(10)
    expect(tiers).toEqual([
      { difficulty: 3, count: 4 },
      { difficulty: 4, count: 4 },
      { difficulty: 5, count: 2 },
    ])
  })

  it('omits zero-count tiers for very small shortfalls', () => {
    expect(distributeGrammarShortfall(1)).toEqual([{ difficulty: 3, count: 1 }])
  })

  it('returns an empty array for a non-positive shortfall', () => {
    expect(distributeGrammarShortfall(0)).toEqual([])
  })
})

describe('chunkCount (10.5: サブバッチ分割)', () => {
  it('splits into chunks of at most chunkSize', () => {
    expect(chunkCount(20, 8)).toEqual([8, 8, 4])
  })

  it('returns a single chunk when total is within chunkSize', () => {
    expect(chunkCount(5, 8)).toEqual([5])
  })

  it('returns an empty array for zero total', () => {
    expect(chunkCount(0, 8)).toEqual([])
  })
})

describe('runAutoBackfill (10章)', () => {
  it('returns inventory only and generates nothing in dry-run mode', async () => {
    checkGrammarInventoryMock.mockResolvedValue([
      { categoryId: 1, categoryCode: 'tense', nameJa: '時制', count: 10, shortfall: 30 },
    ])

    const result = await runAutoBackfill(fakeDeps, { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.grammarInventory).toHaveLength(1)
    expect(result.tasks).toEqual([])
    expect(generateGrammarBatchMock).not.toHaveBeenCalled()
  })

  it('generates, validates, and commits sub-batches for a below-threshold grammar category across the 3 difficulty tiers', async () => {
    checkGrammarInventoryMock.mockResolvedValue([
      { categoryId: 1, categoryCode: 'tense', nameJa: '時制', count: 32, shortfall: 8 },
    ])
    generateGrammarBatchMock.mockImplementation(async (params: { difficulty: number; count: number }) =>
      Promise.resolve({ batchId: `batch-d${params.difficulty}`, itemCount: params.count, truncated: false }),
    )
    validateBatchMock.mockImplementation(async (batchId: string) =>
      Promise.resolve({ total: 1, autoPassed: 1, needsReview: 0, totalItemsInBatch: 1, batchId }),
    )
    commitBatchMock.mockResolvedValue({ committedCount: 1, failedCount: 0 })

    const result = await runAutoBackfill(fakeDeps, { batchSize: 8 })

    // shortfall=8 は3:3:2の比率で difficulty 3/4/5 に按分される
    expect(generateGrammarBatchMock).toHaveBeenCalledTimes(3)
    const counts = generateGrammarBatchMock.mock.calls.map((c) => c[0].count).sort((a, b) => a - b)
    expect(counts).toEqual([2, 3, 3])

    expect(validateBatchMock).toHaveBeenCalledTimes(3)
    expect(commitBatchMock).toHaveBeenCalledTimes(3)
    expect(result.totalGenerated).toBe(8)
    expect(result.totalCommitted).toBe(3)
    expect(result.tasks).toHaveLength(3)
    expect(result.tasks.every((t) => t.label === 'tense' && t.kind === 'grammar')).toBe(true)
  })

  it('routes a shortfall on the idiom tag through contentKind="idiom" with tagName omitted', async () => {
    checkVocabInventoryMock.mockResolvedValue([{ tagId: 4, tagName: 'イディオム', count: 5, shortfall: 5 }])
    generateVocabBatchMock.mockResolvedValue({ batchId: 'batch-idiom', itemCount: 5, truncated: false })

    await runAutoBackfill(fakeDeps, { batchSize: 8 })

    expect(generateVocabBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ contentKind: 'idiom', tagName: undefined, count: 5 }),
      expect.anything(),
    )
  })

  it('does not abort other descriptors when one sub-batch has needs_review items (differs from the one-shot backfill scripts on purpose, 10.4)', async () => {
    checkGrammarInventoryMock.mockResolvedValue([
      { categoryId: 1, categoryCode: 'tense', nameJa: '時制', count: 39, shortfall: 1 },
    ])
    checkVocabInventoryMock.mockResolvedValue([{ tagId: 1, tagName: 'ビジネス', count: 39, shortfall: 1 }])
    generateGrammarBatchMock.mockResolvedValue({ batchId: 'batch-g', itemCount: 1, truncated: false })
    generateVocabBatchMock.mockResolvedValue({ batchId: 'batch-v', itemCount: 1, truncated: false })
    validateBatchMock.mockImplementation(async (batchId: string) =>
      batchId === 'batch-g'
        ? { total: 1, autoPassed: 0, needsReview: 1, totalItemsInBatch: 1 }
        : { total: 1, autoPassed: 1, needsReview: 0, totalItemsInBatch: 1 },
    )
    commitBatchMock.mockResolvedValue({ committedCount: 1, failedCount: 0 })

    const result = await runAutoBackfill(fakeDeps, { batchSize: 8 })

    // needs_reviewが出たgrammar側も、commitBatchは呼ばれる(auto_passed分だけをコミットする既存の
    // commitBatch.tsの実装により安全)。vocab側は問題なく処理が続く。
    expect(commitBatchMock).toHaveBeenCalledTimes(2)
    expect(result.totalNeedsReview).toBe(1)
    expect(result.tasks).toHaveLength(2)
  })

  it('shrinks the batch size and retries after a retryable (503) generation failure, eventually succeeding (10.7)', async () => {
    checkVocabInventoryMock.mockResolvedValue([{ tagId: 1, tagName: 'ビジネス', count: 34, shortfall: 6 }])
    let callIndex = 0
    generateVocabBatchMock.mockImplementation(async (params: { count: number }) => {
      if (params.count >= 4) {
        throw new ApiError({ message: 'overloaded', status: 503 })
      }
      callIndex += 1
      return { batchId: `batch-${callIndex}`, itemCount: params.count, truncated: false }
    })

    const result = await runAutoBackfill(fakeDeps, { batchSize: 6, minBatchSize: 2 })

    // 6件→縮小失敗→3件+3件でそれぞれ再試行して成功
    expect(generateVocabBatchMock).toHaveBeenCalledTimes(3) // 6(失敗) + 3 + 3
    expect(result.totalGenerated).toBe(6)
    expect(result.tasks[0].gaveUpCount).toBe(0)
    expect(result.tasks[0].batchIds).toHaveLength(2)
  })

  it('gives up and reports gaveUpCount when even the minimum batch size keeps failing with 503', async () => {
    checkVocabInventoryMock.mockResolvedValue([{ tagId: 1, tagName: 'ビジネス', count: 38, shortfall: 2 }])
    generateVocabBatchMock.mockRejectedValue(new ApiError({ message: 'still overloaded', status: 503 }))

    const result = await runAutoBackfill(fakeDeps, { batchSize: 8, minBatchSize: 2 })

    expect(result.tasks[0].gaveUpCount).toBe(2)
    expect(result.tasks[0].generatedCount).toBe(0)
    expect(result.totalGenerated).toBe(0)
  })

  it('propagates a non-retryable error immediately without shrink-retrying', async () => {
    checkVocabInventoryMock.mockResolvedValue([{ tagId: 1, tagName: 'ビジネス', count: 39, shortfall: 5 }])
    generateVocabBatchMock.mockRejectedValue(new Error('unrelated fatal error'))

    await expect(runAutoBackfill(fakeDeps, { batchSize: 8 })).rejects.toThrow('unrelated fatal error')
  })

  it('caps total generation at maxTotal and reports the skipped category/tag for the next run (10.12)', async () => {
    checkGrammarInventoryMock.mockResolvedValue([
      { categoryId: 1, categoryCode: 'tense', nameJa: '時制', count: 0, shortfall: 8 },
    ])
    checkVocabInventoryMock.mockResolvedValue([{ tagId: 1, tagName: 'ビジネス', count: 0, shortfall: 8 }])
    generateGrammarBatchMock.mockImplementation(async (params: { count: number }) =>
      Promise.resolve({ batchId: 'batch-g', itemCount: params.count, truncated: false }),
    )
    generateVocabBatchMock.mockImplementation(async (params: { count: number }) =>
      Promise.resolve({ batchId: 'batch-v', itemCount: params.count, truncated: false }),
    )

    const result = await runAutoBackfill(fakeDeps, { batchSize: 8, maxTotal: 8 })

    // grammarの8件だけでmaxTotal(8)を使い切るため、vocab側は今回未着手として報告される
    expect(result.totalGenerated).toBe(8)
    expect(result.skippedDueToMaxTotal).toEqual([{ kind: 'vocab', label: 'ビジネス', shortfall: 8 }])
  })
})
