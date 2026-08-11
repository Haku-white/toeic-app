import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@google/genai'

const generateContentMock = vi.fn()

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>()
  return {
    ...actual,
    // アロー関数はnew演算子で使えない（[[Construct]]を持たない）ため、通常のfunctionにする
    GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAIMock() {
      return { models: { generateContent: generateContentMock } }
    }),
  }
})

vi.mock('./env', () => ({
  loadEnv: vi.fn(() => ({
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    GEMINI_API_KEY: 'test-api-key',
    GEMINI_MODEL: 'gemini-3.6-flash',
  })),
}))

const { generateJson, generateJsonArray, extractCompleteArrayItems } = await import('./gemini')

beforeEach(() => {
  generateContentMock.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('generateJson (17章: リトライ戦略)', () => {
  it('returns parsed JSON on the first success without retrying', async () => {
    generateContentMock.mockResolvedValue({ text: '{"foo":1}' })

    const result = await generateJson({ prompt: 'p', schema: {} })

    expect(result).toEqual({ foo: 1 })
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('retries on a retryable status (503) and succeeds on the next attempt', async () => {
    generateContentMock
      .mockRejectedValueOnce(new ApiError({ message: 'overloaded', status: 503 }))
      .mockResolvedValueOnce({ text: '{"foo":2}' })

    const promise = generateJson({ prompt: 'p', schema: {} })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ foo: 2 })
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })

  it('retries on a rate-limit status (429) as well', async () => {
    generateContentMock
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }))
      .mockResolvedValueOnce({ text: '{"foo":3}' })

    const promise = generateJson({ prompt: 'p', schema: {} })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ foo: 3 })
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable status (400) and throws immediately', async () => {
    generateContentMock.mockRejectedValue(new ApiError({ message: 'bad request', status: 400 }))

    await expect(generateJson({ prompt: 'p', schema: {} })).rejects.toThrow('bad request')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a plain (non-ApiError) error', async () => {
    generateContentMock.mockRejectedValue(new Error('network down'))

    await expect(generateJson({ prompt: 'p', schema: {} })).rejects.toThrow('network down')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('retries on a network-level fetch failure (e.g. ECONNRESET) surfaced via TypeError.cause', async () => {
    // Node/undiciの実際の失敗形: `TypeError: fetch failed`で、実際の原因は`.cause`に入る
    const econnreset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const fetchFailed = new TypeError('fetch failed', { cause: econnreset })
    generateContentMock.mockRejectedValueOnce(fetchFailed).mockResolvedValueOnce({ text: '{"foo":4}' })

    const promise = generateJson({ prompt: 'p', schema: {} })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ foo: 4 })
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a fetch failure with a non-retryable cause code', async () => {
    const other = Object.assign(new Error('some other network issue'), { code: 'EOTHER' })
    generateContentMock.mockRejectedValue(new TypeError('fetch failed', { cause: other }))

    await expect(generateJson({ prompt: 'p', schema: {} })).rejects.toThrow('fetch failed')
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after exhausting retries and throws the last retryable error', async () => {
    generateContentMock.mockRejectedValue(new ApiError({ message: 'still overloaded', status: 503 }))

    const promise = generateJson({ prompt: 'p', schema: {} })
    const expectation = expect(promise).rejects.toThrow('still overloaded')
    await vi.runAllTimersAsync()
    await expectation

    // 初回呼び出し + MAX_RETRIES(5)回のリトライ = 6回
    expect(generateContentMock).toHaveBeenCalledTimes(6)
  })
})

describe('generateJsonArray (10.6: バッチ配列の切り詰め検知・部分救済)', () => {
  it('returns a clean array with truncated/parseRecovered both false on a normal response', async () => {
    generateContentMock.mockResolvedValue({
      text: '[{"foo":1},{"foo":2}]',
      candidates: [{ finishReason: 'STOP' }],
    })

    const result = await generateJsonArray({ prompt: 'p', schema: {} })

    expect(result).toEqual({ items: [{ foo: 1 }, { foo: 2 }], truncated: false, parseRecovered: false })
  })

  it('flags truncated=true when finishReason is MAX_TOKENS even if the JSON still parsed cleanly', async () => {
    generateContentMock.mockResolvedValue({
      text: '[{"foo":1}]',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    })

    const result = await generateJsonArray({ prompt: 'p', schema: {} })

    expect(result).toEqual({ items: [{ foo: 1 }], truncated: true, parseRecovered: false })
  })

  it('recovers complete leading items and drops the incomplete trailing item when JSON.parse fails', async () => {
    // 3件目が出力トークン上限で途中で切れているケースを模す
    generateContentMock.mockResolvedValue({
      text: '[{"word":"a"},{"word":"b"},{"word":"c","meaning_ja":"切',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    })

    const result = await generateJsonArray({ prompt: 'p', schema: {} })

    expect(result).toEqual({
      items: [{ word: 'a' }, { word: 'b' }],
      truncated: true,
      parseRecovered: true,
    })
  })

  it('still retries on a retryable status (503) before succeeding, same as generateJson', async () => {
    generateContentMock
      .mockRejectedValueOnce(new ApiError({ message: 'overloaded', status: 503 }))
      .mockResolvedValueOnce({ text: '[{"foo":1}]', candidates: [{ finishReason: 'STOP' }] })

    const promise = generateJsonArray({ prompt: 'p', schema: {} })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ items: [{ foo: 1 }], truncated: false, parseRecovered: false })
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })
})

describe('extractCompleteArrayItems (10.6)', () => {
  it('extracts all items from a well-formed array', () => {
    const items = extractCompleteArrayItems('[{"a":1},{"a":2},{"a":3}]')
    expect(items).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })

  it('drops only the incomplete trailing item when the text is cut off mid-object', () => {
    const items = extractCompleteArrayItems('[{"a":1},{"a":2},{"a":3,"b":"unterm')
    expect(items).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('correctly tracks nested arrays within an item (e.g. a "choices" field) without miscounting depth', () => {
    const items = extractCompleteArrayItems(
      '[{"choices":["a","b","c","d"],"correct_index":1},{"choices":["e","f"]',
    )
    expect(items).toEqual([{ choices: ['a', 'b', 'c', 'd'], correct_index: 1 }])
  })

  it('ignores brackets that appear inside string values', () => {
    const items = extractCompleteArrayItems('[{"text":"a [bracket] and {brace} inside a string"},{"text":"b"}]')
    expect(items).toEqual([{ text: 'a [bracket] and {brace} inside a string' }, { text: 'b' }])
  })

  it('returns an empty array when there is no "[" in the text', () => {
    expect(extractCompleteArrayItems('not json at all')).toEqual([])
  })

  it('returns an empty array when even the first item is incomplete', () => {
    expect(extractCompleteArrayItems('[{"a":1,"b":"cut off')).toEqual([])
  })
})
