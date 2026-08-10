import { describe, expect, it } from 'vitest'
import { grammarItemSchema, selfCheckResultSchema, vocabItemSchema } from './schemas'

const validGrammarItem = {
  question_text: 'The company ___ its report by Friday.',
  choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
  correct_index: 0,
  explanation: '未来完了形を使う。',
  difficulty: 3,
  category_code: 'tense',
}

const validVocabItem = {
  word: 'negotiate',
  part_of_speech: 'verb',
  meaning_ja: '交渉する',
  example_sentence_en: 'We need to negotiate the contract.',
  example_sentence_ja: '契約について交渉する必要がある。',
  toeic_band: 730,
  etymology_note: 'neg-(否定)+otium(暇)→「暇ではない」',
  tags: ['ビジネス'],
}

describe('grammarItemSchema', () => {
  it('accepts a well-formed item', () => {
    expect(grammarItemSchema.safeParse(validGrammarItem).success).toBe(true)
  })

  it('rejects choices with fewer than 4 entries', () => {
    const result = grammarItemSchema.safeParse({ ...validGrammarItem, choices: ['a', 'b', 'c'] })
    expect(result.success).toBe(false)
  })

  it('rejects correct_index out of range', () => {
    const result = grammarItemSchema.safeParse({ ...validGrammarItem, correct_index: 4 })
    expect(result.success).toBe(false)
  })

  it('rejects difficulty out of the 1-5 range', () => {
    const result = grammarItemSchema.safeParse({ ...validGrammarItem, difficulty: 6 })
    expect(result.success).toBe(false)
  })

  it('rejects an empty explanation', () => {
    const result = grammarItemSchema.safeParse({ ...validGrammarItem, explanation: '' })
    expect(result.success).toBe(false)
  })
})

describe('vocabItemSchema', () => {
  it('accepts a well-formed item', () => {
    expect(vocabItemSchema.safeParse(validVocabItem).success).toBe(true)
  })

  it('rejects an empty tags array', () => {
    const result = vocabItemSchema.safeParse({ ...validVocabItem, tags: [] })
    expect(result.success).toBe(false)
  })

  it('rejects a missing etymology_note', () => {
    const { etymology_note: _omit, ...withoutEtymology } = validVocabItem
    const result = vocabItemSchema.safeParse(withoutEtymology)
    expect(result.success).toBe(false)
  })
})

describe('selfCheckResultSchema', () => {
  it('accepts a well-formed result', () => {
    const result = selfCheckResultSchema.safeParse({
      reasoning: '空所の後は完全な節。whileは接続詞で節を伴うため正解。',
      solved_index: 0,
      is_ambiguous: false,
      confidence: 0.95,
    })
    expect(result.success).toBe(true)
  })

  it('rejects confidence outside 0-1', () => {
    const result = selfCheckResultSchema.safeParse({
      reasoning: 'reason',
      solved_index: 0,
      is_ambiguous: false,
      confidence: 1.5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing reasoning', () => {
    const result = selfCheckResultSchema.safeParse({
      solved_index: 0,
      is_ambiguous: false,
      confidence: 0.95,
    })
    expect(result.success).toBe(false)
  })

  it('allows ambiguity_reason to be omitted', () => {
    const result = selfCheckResultSchema.safeParse({
      reasoning: 'reason',
      solved_index: 1,
      is_ambiguous: true,
      confidence: 0.4,
    })
    expect(result.success).toBe(true)
  })
})
