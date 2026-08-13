import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@google/genai'

const generateVocabBatchFromWordlistMock = vi.fn()
vi.mock('./generateVocab', () => ({
  generateVocabBatchFromWordlist: generateVocabBatchFromWordlistMock,
}))

const validateBatchMock = vi.fn()
const loadExistingVocabWordPosPairsMock = vi.fn()
vi.mock('./validateBatch', () => ({
  validateBatch: validateBatchMock,
  loadExistingVocabWordPosPairs: loadExistingVocabWordPosPairsMock,
}))

const commitBatchMock = vi.fn()
vi.mock('./commitBatch', () => ({ commitBatch: commitBatchMock }))

const { runCefrjImport } = await import('./runCefrjImport')

const immediatePool = { run: <T>(task: () => Promise<T>) => task() }
const fakeDeps = {
  supabase: {} as never,
  generateJsonArray: vi.fn() as never,
  generateJson: vi.fn() as never,
  pool: immediatePool,
}

const SAMPLE_CSV = [
  'headword,pos,CEFR',
  'abandon,verb,B1',
  'able,adjective,B1',
  'abnormal,adjective,B2',
  'absence,noun,B1',
  'absolute,adjective,B2',
  'absorb,verb,B1',
].join('\n')

beforeEach(() => {
  generateVocabBatchFromWordlistMock.mockReset()
  validateBatchMock.mockReset().mockResolvedValue({ total: 0, autoPassed: 0, needsReview: 0, totalItemsInBatch: 0 })
  loadExistingVocabWordPosPairsMock.mockReset().mockResolvedValue(new Set())
  commitBatchMock.mockReset().mockResolvedValue({ committedCount: 0, failedCount: 0 })
})

describe('runCefrjImport (21.9)', () => {
  it('returns candidate counts only and generates nothing in dry-run mode', async () => {
    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.totalCandidates).toBe(6)
    expect(result.selectedCount).toBe(6)
    expect(result.chunks).toEqual([])
    expect(generateVocabBatchFromWordlistMock).not.toHaveBeenCalled()
  })

  it('excludes existing word+part_of_speech pairs before selecting (dedup reused from validateBatch.ts)', async () => {
    loadExistingVocabWordPosPairsMock.mockResolvedValue(new Set(['abandon|verb']))
    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, dryRun: true })
    expect(result.totalCandidates).toBe(5)
  })

  it('filters by the requested CEFR levels only', async () => {
    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, levels: ['B2'], dryRun: true })
    expect(result.totalCandidates).toBe(2) // abnormal, absolute
  })

  it('chunks selected words into sub-batches, generates/validates/commits each, and aggregates results', async () => {
    generateVocabBatchFromWordlistMock.mockImplementation(async (params: { words: unknown[] }) => ({
      batchId: `batch-${params.words.length}`,
      itemCount: params.words.length,
      truncated: false,
    }))
    validateBatchMock.mockResolvedValue({ total: 2, autoPassed: 2, needsReview: 0, totalItemsInBatch: 2 })
    commitBatchMock.mockResolvedValue({ committedCount: 2, failedCount: 0 })

    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, batchSize: 2 })

    expect(generateVocabBatchFromWordlistMock).toHaveBeenCalledTimes(3) // 6語 / batchSize 2
    expect(result.chunks).toHaveLength(3)
    expect(result.totalGenerated).toBe(6)
    expect(result.totalCommitted).toBe(6)
  })

  it('caps the selected word count at maxTotal via sampleEvenly', async () => {
    generateVocabBatchFromWordlistMock.mockImplementation(async (params: { words: unknown[] }) => ({
      batchId: 'b',
      itemCount: params.words.length,
      truncated: false,
    }))
    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, batchSize: 10, maxTotal: 3 })
    expect(result.selectedCount).toBe(3)
  })

  it('does not abort other chunks when one sub-batch has needs_review items (10.4と同じ方針)', async () => {
    generateVocabBatchFromWordlistMock.mockImplementation(async (params: { words: Array<{ word: string }> }) => ({
      batchId: `batch-${params.words[0].word}`,
      itemCount: params.words.length,
      truncated: false,
    }))
    validateBatchMock.mockImplementation(async (batchId: string) =>
      batchId.includes('abandon')
        ? { total: 2, autoPassed: 0, needsReview: 2, totalItemsInBatch: 2 }
        : { total: 2, autoPassed: 2, needsReview: 0, totalItemsInBatch: 2 },
    )
    commitBatchMock.mockResolvedValue({ committedCount: 2, failedCount: 0 })

    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, batchSize: 2 })

    expect(commitBatchMock).toHaveBeenCalledTimes(3)
    expect(result.totalNeedsReview).toBe(2)
  })

  it('shrinks the word-chunk and retries after a retryable (503) generation failure', async () => {
    generateVocabBatchFromWordlistMock.mockImplementation(async (params: { words: unknown[] }) => {
      if (params.words.length >= 4) {
        throw new ApiError({ message: 'overloaded', status: 503 })
      }
      return { batchId: `batch-${params.words.length}`, itemCount: params.words.length, truncated: false }
    })

    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, batchSize: 6, minBatchSize: 2 })

    // 6件失敗 -> 3件+3件に縮小してそれぞれ成功
    expect(generateVocabBatchFromWordlistMock).toHaveBeenCalledTimes(3)
    expect(result.chunks[0].generatedCount).toBe(6)
    expect(result.chunks[0].gaveUpCount).toBe(0)
    expect(result.chunks[0].batchIds).toHaveLength(2)
  })

  it('gives up and reports gaveUpCount when even the minimum batch size keeps failing with 503', async () => {
    generateVocabBatchFromWordlistMock.mockRejectedValue(new ApiError({ message: 'still overloaded', status: 503 }))

    const result = await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, batchSize: 6, minBatchSize: 2 })

    expect(result.chunks[0].gaveUpCount).toBe(6)
    expect(result.chunks[0].generatedCount).toBe(0)
  })

  it('propagates a non-retryable error immediately without shrink-retrying', async () => {
    generateVocabBatchFromWordlistMock.mockRejectedValue(new Error('unrelated fatal error'))
    await expect(runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, batchSize: 6 })).rejects.toThrow(
      'unrelated fatal error',
    )
  })

  it('passes the max CEFR-derived TOEIC band within each chunk as targetBand', async () => {
    generateVocabBatchFromWordlistMock.mockResolvedValue({ batchId: 'b', itemCount: 6, truncated: false })
    await runCefrjImport(fakeDeps, { csvText: SAMPLE_CSV, batchSize: 10 })
    // このサンプルCSVはB1(600)とB2(730)が混在する1チャンクになるため、最大値730が使われる
    expect(generateVocabBatchFromWordlistMock.mock.calls[0][0].targetBand).toBe(730)
  })
})
