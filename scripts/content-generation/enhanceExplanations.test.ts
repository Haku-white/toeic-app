import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '@google/genai'

const findWeakGrammarQuestionsMock = vi.fn()
const findWeakVocabWordsMock = vi.fn()
vi.mock('./weaknessDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./weaknessDetection')>()
  return { ...actual, findWeakGrammarQuestions: findWeakGrammarQuestionsMock, findWeakVocabWords: findWeakVocabWordsMock }
})

const generateGrammarExplanationsMock = vi.fn()
const generateVocabExplanationsMock = vi.fn()
vi.mock('./generateExplanationEnhancement', () => ({
  generateGrammarExplanations: generateGrammarExplanationsMock,
  generateVocabExplanations: generateVocabExplanationsMock,
}))

const validateBatchMock = vi.fn()
vi.mock('./validateBatch', () => ({ validateBatch: validateBatchMock }))

const commitBatchMock = vi.fn()
vi.mock('./commitBatch', () => ({ commitBatch: commitBatchMock }))

const { runExplanationEnhancement } = await import('./enhanceExplanations')

const immediatePool = { run: <T>(task: () => Promise<T>) => task() }
const fakeDeps = {
  supabase: {} as never,
  generateJsonArray: vi.fn() as never,
  generateJson: vi.fn() as never,
  pool: immediatePool,
}

function makeWeakGrammar(id: string) {
  return {
    id,
    questionText: `Q ${id}`,
    choices: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'exp',
    accuracyRate: 0.5,
    attemptCount: 8,
  }
}

function makeWeakVocab(id: string) {
  return { id, word: `word-${id}`, meaningJa: '意味', etymologyNote: null, againRate: 0.4, reviewCount: 6 }
}

beforeEach(() => {
  findWeakGrammarQuestionsMock.mockReset().mockResolvedValue([])
  findWeakVocabWordsMock.mockReset().mockResolvedValue([])
  generateGrammarExplanationsMock.mockReset()
  generateVocabExplanationsMock.mockReset()
  validateBatchMock.mockReset().mockResolvedValue({ total: 0, autoPassed: 0, needsReview: 0, totalItemsInBatch: 0 })
  commitBatchMock.mockReset().mockResolvedValue({ committedCount: 0, failedCount: 0 })
})

describe('runExplanationEnhancement (11章)', () => {
  it('returns target counts only and generates nothing in dry-run mode', async () => {
    findWeakGrammarQuestionsMock.mockResolvedValue([makeWeakGrammar('q-1')])
    findWeakVocabWordsMock.mockResolvedValue([makeWeakVocab('v-1')])

    const result = await runExplanationEnhancement(fakeDeps, { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.weakGrammar).toHaveLength(1)
    expect(result.weakVocab).toHaveLength(1)
    expect(result.tasks).toEqual([])
    expect(generateGrammarExplanationsMock).not.toHaveBeenCalled()
    expect(generateVocabExplanationsMock).not.toHaveBeenCalled()
  })

  it('chunks weak items into batches, generates/validates/commits each, and aggregates results', async () => {
    const grammarItems = Array.from({ length: 3 }, (_, i) => makeWeakGrammar(`q-${i}`))
    findWeakGrammarQuestionsMock.mockResolvedValue(grammarItems)
    generateGrammarExplanationsMock.mockImplementation(async (params: { items: unknown[] }) => ({
      batchId: 'batch-g',
      itemCount: params.items.length,
      truncated: false,
    }))
    validateBatchMock.mockResolvedValue({ total: 3, autoPassed: 3, needsReview: 0, totalItemsInBatch: 3 })
    commitBatchMock.mockResolvedValue({ committedCount: 3, failedCount: 0 })

    const result = await runExplanationEnhancement(fakeDeps, { batchSize: 8 })

    expect(generateGrammarExplanationsMock).toHaveBeenCalledTimes(1)
    expect(generateGrammarExplanationsMock.mock.calls[0][0].items).toHaveLength(3)
    expect(validateBatchMock).toHaveBeenCalledTimes(1)
    expect(commitBatchMock).toHaveBeenCalledTimes(1)
    expect(result.totalEnhanced).toBe(3)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]).toMatchObject({ kind: 'grammar', requestedCount: 3, generatedCount: 3, committedCount: 3 })
  })

  it('splits weak items across multiple sub-batches according to batchSize', async () => {
    findWeakVocabWordsMock.mockResolvedValue(Array.from({ length: 10 }, (_, i) => makeWeakVocab(`v-${i}`)))
    generateVocabExplanationsMock.mockImplementation(async (params: { items: unknown[] }) => ({
      batchId: `batch-${params.items.length}`,
      itemCount: params.items.length,
      truncated: false,
    }))

    const result = await runExplanationEnhancement(fakeDeps, { batchSize: 6 })

    expect(generateVocabExplanationsMock).toHaveBeenCalledTimes(2)
    const counts = generateVocabExplanationsMock.mock.calls.map((c) => c[0].items.length).sort((a, b) => b - a)
    expect(counts).toEqual([6, 4])
    expect(result.tasks).toHaveLength(2)
  })

  it('does not abort other chunks when one sub-batch has needs_review items', async () => {
    findWeakGrammarQuestionsMock.mockResolvedValue([makeWeakGrammar('q-1')])
    findWeakVocabWordsMock.mockResolvedValue([makeWeakVocab('v-1')])
    generateGrammarExplanationsMock.mockResolvedValue({ batchId: 'batch-g', itemCount: 1, truncated: false })
    generateVocabExplanationsMock.mockResolvedValue({ batchId: 'batch-v', itemCount: 1, truncated: false })
    validateBatchMock.mockImplementation(async (batchId: string) =>
      batchId === 'batch-g'
        ? { total: 1, autoPassed: 0, needsReview: 1, totalItemsInBatch: 1 }
        : { total: 1, autoPassed: 1, needsReview: 0, totalItemsInBatch: 1 },
    )
    commitBatchMock.mockResolvedValue({ committedCount: 1, failedCount: 0 })

    const result = await runExplanationEnhancement(fakeDeps, { batchSize: 8 })

    expect(commitBatchMock).toHaveBeenCalledTimes(2)
    expect(result.totalNeedsReview).toBe(1)
    expect(result.tasks).toHaveLength(2)
  })

  it('shrinks the target-item list and retries after a retryable (503) generation failure', async () => {
    findWeakVocabWordsMock.mockResolvedValue(Array.from({ length: 6 }, (_, i) => makeWeakVocab(`v-${i}`)))
    generateVocabExplanationsMock.mockImplementation(async (params: { items: Array<{ id: string }> }) => {
      if (params.items.length >= 4) {
        throw new ApiError({ message: 'overloaded', status: 503 })
      }
      return { batchId: `batch-${params.items.map((i) => i.id).join('-')}`, itemCount: params.items.length, truncated: false }
    })

    const result = await runExplanationEnhancement(fakeDeps, { batchSize: 6, minBatchSize: 2 })

    // 6件失敗 -> 3件+3件に縮小してそれぞれ成功
    expect(generateVocabExplanationsMock).toHaveBeenCalledTimes(3)
    expect(result.tasks[0].generatedCount).toBe(6)
    expect(result.tasks[0].gaveUpCount).toBe(0)
    expect(result.tasks[0].batchIds).toHaveLength(2)
  })

  it('gives up and reports gaveUpCount when even the minimum batch size keeps failing with 503', async () => {
    findWeakVocabWordsMock.mockResolvedValue(Array.from({ length: 2 }, (_, i) => makeWeakVocab(`v-${i}`)))
    generateVocabExplanationsMock.mockRejectedValue(new ApiError({ message: 'still overloaded', status: 503 }))

    const result = await runExplanationEnhancement(fakeDeps, { batchSize: 8, minBatchSize: 2 })

    expect(result.tasks[0].gaveUpCount).toBe(2)
    expect(result.tasks[0].generatedCount).toBe(0)
  })

  it('propagates a non-retryable error immediately without shrink-retrying', async () => {
    findWeakVocabWordsMock.mockResolvedValue(Array.from({ length: 5 }, (_, i) => makeWeakVocab(`v-${i}`)))
    generateVocabExplanationsMock.mockRejectedValue(new Error('unrelated fatal error'))

    await expect(runExplanationEnhancement(fakeDeps, { batchSize: 8 })).rejects.toThrow('unrelated fatal error')
  })

  it('caps total items at maxTotal, prioritizing grammar, and reports the skipped counts', async () => {
    findWeakGrammarQuestionsMock.mockResolvedValue(Array.from({ length: 8 }, (_, i) => makeWeakGrammar(`q-${i}`)))
    findWeakVocabWordsMock.mockResolvedValue(Array.from({ length: 8 }, (_, i) => makeWeakVocab(`v-${i}`)))
    generateGrammarExplanationsMock.mockImplementation(async (params: { items: unknown[] }) => ({
      batchId: 'batch-g',
      itemCount: params.items.length,
      truncated: false,
    }))

    const result = await runExplanationEnhancement(fakeDeps, { batchSize: 8, maxTotal: 8 })

    // grammarの8件だけでmaxTotal(8)を使い切るため、vocabは今回スキップされる
    expect(generateVocabExplanationsMock).not.toHaveBeenCalled()
    expect(result.grammarSkippedCount).toBe(0)
    expect(result.vocabSkippedCount).toBe(8)
  })
})
