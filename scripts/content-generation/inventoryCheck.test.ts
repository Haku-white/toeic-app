import { describe, expect, it, vi } from 'vitest'
import { checkGrammarInventory, checkVocabInventory } from './inventoryCheck'

type MockResult = { data: unknown; error: unknown; count?: number | null }

function makeQueryBuilder(result: MockResult) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.then = (
    onFulfilled: (value: MockResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

describe('checkGrammarInventory (10.2/10.3)', () => {
  it('counts grammar_questions per category via count:exact/head:true and filters by threshold', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'grammar_categories') {
        return makeQueryBuilder({
          data: [
            { id: 1, code: 'tense', name_ja: '時制' },
            { id: 2, code: 'voice', name_ja: '態' },
            { id: 3, code: 'subjunctive', name_ja: '仮定法' },
          ],
          error: null,
        })
      }
      if (table === 'grammar_questions') {
        const builder: Record<string, unknown> = {}
        builder.select = vi.fn(() => builder)
        builder.eq = vi.fn((_col: string, categoryId: number) => {
          const counts: Record<number, number> = { 1: 10, 2: 35, 3: 0 }
          return Promise.resolve({ data: null, error: null, count: counts[categoryId] })
        })
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof checkGrammarInventory>[0]

    const result = await checkGrammarInventory(supabase, 30, 40)

    expect(result).toEqual([
      { categoryId: 1, categoryCode: 'tense', nameJa: '時制', count: 10, shortfall: 30 },
      { categoryId: 3, categoryCode: 'subjunctive', nameJa: '仮定法', count: 0, shortfall: 40 },
    ])
    // 閾値以上(voice, 35件)は結果に含まれない
    expect(result.find((r) => r.categoryCode === 'voice')).toBeUndefined()
  })

  it('propagates an error from the categories lookup', async () => {
    const fromMock = vi.fn(() => makeQueryBuilder({ data: null, error: new Error('db down') }))
    const supabase = { from: fromMock } as unknown as Parameters<typeof checkGrammarInventory>[0]
    await expect(checkGrammarInventory(supabase)).rejects.toThrow('db down')
  })
})

describe('checkVocabInventory (10.2/10.3)', () => {
  it('counts vocab_word_tags per tag and filters by threshold', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'vocab_tags') {
        return makeQueryBuilder({
          data: [
            { id: 1, name: 'ビジネス', code: 'business' },
            { id: 2, name: '日常会話', code: 'daily_conversation' },
            { id: 3, name: 'Part7頻出', code: 'part7' },
          ],
          error: null,
        })
      }
      if (table === 'vocab_word_tags') {
        const builder: Record<string, unknown> = {}
        builder.select = vi.fn(() => builder)
        builder.eq = vi.fn((_col: string, tagId: number) => {
          const counts: Record<number, number> = { 1: 20, 2: 45, 3: 5 }
          return Promise.resolve({ data: null, error: null, count: counts[tagId] })
        })
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof checkVocabInventory>[0]

    const result = await checkVocabInventory(supabase, 30, 40)

    expect(result).toEqual([
      { tagId: 1, tagName: 'ビジネス', count: 20, shortfall: 20 },
      { tagId: 3, tagName: 'Part7頻出', count: 5, shortfall: 35 },
    ])
    expect(result.find((r) => r.tagName === '日常会話')).toBeUndefined()
  })

  it('skips tags with no code or an unregistered name (not in VOCAB_TAG_CODES), logging a warning', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fromMock = vi.fn((table: string) => {
      if (table === 'vocab_tags') {
        return makeQueryBuilder({
          data: [
            { id: 1, name: '未知のタグ', code: null },
            { id: 2, name: 'ビジネス', code: 'business' },
          ],
          error: null,
        })
      }
      if (table === 'vocab_word_tags') {
        const builder: Record<string, unknown> = {}
        builder.select = vi.fn(() => builder)
        builder.eq = vi.fn(() => Promise.resolve({ data: null, error: null, count: 5 }))
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<typeof checkVocabInventory>[0]

    const result = await checkVocabInventory(supabase, 30, 40)

    expect(result).toEqual([{ tagId: 2, tagName: 'ビジネス', count: 5, shortfall: 35 }])
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('未知のタグ'))
    consoleWarnSpy.mockRestore()
  })

  it('propagates an error from the tags lookup', async () => {
    const fromMock = vi.fn(() => makeQueryBuilder({ data: null, error: new Error('db down') }))
    const supabase = { from: fromMock } as unknown as Parameters<typeof checkVocabInventory>[0]
    await expect(checkVocabInventory(supabase)).rejects.toThrow('db down')
  })
})
