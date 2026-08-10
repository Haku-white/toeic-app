import { describe, expect, it, vi } from 'vitest'
import { buildSelfCheckPrompt, judgeSelfCheck, runGrammarSelfCheck } from './selfCheck'

describe('judgeSelfCheck', () => {
  it('passes when solved_index matches, not ambiguous, and confidence is high', () => {
    expect(judgeSelfCheck(0, { reasoning: 'r', solved_index: 0, is_ambiguous: false, confidence: 0.9 })).toBe(true)
  })

  it('fails when solved_index does not match', () => {
    expect(judgeSelfCheck(0, { reasoning: 'r', solved_index: 1, is_ambiguous: false, confidence: 0.9 })).toBe(false)
  })

  it('fails when is_ambiguous is true even if the index matches', () => {
    expect(judgeSelfCheck(0, { reasoning: 'r', solved_index: 0, is_ambiguous: true, confidence: 0.9 })).toBe(false)
  })

  it('fails when confidence is below the threshold', () => {
    expect(judgeSelfCheck(0, { reasoning: 'r', solved_index: 0, is_ambiguous: false, confidence: 0.5 })).toBe(false)
  })

  it('respects a custom confidence threshold', () => {
    const result = { reasoning: 'r', solved_index: 0, is_ambiguous: false, confidence: 0.75 }
    expect(judgeSelfCheck(0, result, 0.8)).toBe(false)
    expect(judgeSelfCheck(0, result, 0.7)).toBe(true)
  })
})

describe('buildSelfCheckPrompt', () => {
  it('includes the question text, choices, and the reasoning-first instruction', () => {
    const prompt = buildSelfCheckPrompt({
      questionText: 'The company ___ its report.',
      choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
    })
    expect(prompt).toContain('The company ___ its report.')
    expect(prompt).toContain('選択肢: 0: will have submitted / 1: submits / 2: submitted / 3: submitting')
    expect(prompt).toContain('is_ambiguous を true')
    expect(prompt).toContain('reasoning に簡潔に記述してから')
  })

  it('instructs how to distinguish conjunctions from prepositions by what follows the blank', () => {
    const prompt = buildSelfCheckPrompt({ questionText: 'q', choices: ['a', 'b', 'c', 'd'] })
    expect(prompt).toContain('完全な節')
    expect(prompt).toContain('名詞句')
    expect(prompt).toContain('接続詞・接続詞句')
    expect(prompt).toContain('前置詞・前置詞句')
  })

  it('instructs how to judge relative pronoun case/type by its role in the clause', () => {
    const prompt = buildSelfCheckPrompt({ questionText: 'q', choices: ['a', 'b', 'c', 'd'] })
    expect(prompt).toContain('主格')
    expect(prompt).toContain('目的格')
    expect(prompt).toContain('先行詞が人か物か')
  })

  it('instructs how to judge mixed-conditional tense by time markers', () => {
    const prompt = buildSelfCheckPrompt({ questionText: 'q', choices: ['a', 'b', 'c', 'd'] })
    expect(prompt).toContain('仮定法過去完了')
    expect(prompt).toContain('混合仮定法')
  })

  it('lists choices with explicit 0-based indices to avoid solved_index off-by-one mistakes', () => {
    const prompt = buildSelfCheckPrompt({ questionText: 'q', choices: ['a', 'b', 'c', 'd'] })
    expect(prompt).toContain('選択肢: 0: a / 1: b / 2: c / 3: d')
    expect(prompt).toContain('0始まり')
  })
})

describe('runGrammarSelfCheck', () => {
  it('calls generateJson with the self-check prompt/schema and judges the result', async () => {
    const generateJson = vi
      .fn()
      .mockResolvedValue({ reasoning: 'r', solved_index: 2, is_ambiguous: false, confidence: 0.95 })

    const result = await runGrammarSelfCheck(
      {
        question_text: 'If the meeting ___ postponed, we would have missed it.',
        choices: ['is', 'was', 'had been', 'were'],
        correct_index: 2,
      },
      generateJson,
    )

    expect(result.passed).toBe(true)
    expect(result.payload).toEqual({ reasoning: 'r', solved_index: 2, is_ambiguous: false, confidence: 0.95 })
    expect(generateJson).toHaveBeenCalledTimes(1)
    expect(generateJson.mock.calls[0][0].prompt).toContain('If the meeting ___ postponed')
  })

  it('fails when the self-check result does not match the declared correct_index', async () => {
    const generateJson = vi
      .fn()
      .mockResolvedValue({ reasoning: 'r', solved_index: 0, is_ambiguous: false, confidence: 0.95 })

    const result = await runGrammarSelfCheck(
      { question_text: 'q', choices: ['a', 'b', 'c', 'd'], correct_index: 2 },
      generateJson,
    )

    expect(result.passed).toBe(false)
  })

  it('throws when the response does not match the self-check schema', async () => {
    const generateJson = vi.fn().mockResolvedValue({ solved_index: 'not-a-number' })
    await expect(
      runGrammarSelfCheck({ question_text: 'q', choices: ['a', 'b', 'c', 'd'], correct_index: 0 }, generateJson),
    ).rejects.toThrow()
  })

  it('throws when reasoning is missing from the response', async () => {
    const generateJson = vi.fn().mockResolvedValue({ solved_index: 0, is_ambiguous: false, confidence: 0.95 })
    await expect(
      runGrammarSelfCheck({ question_text: 'q', choices: ['a', 'b', 'c', 'd'], correct_index: 0 }, generateJson),
    ).rejects.toThrow()
  })
})
