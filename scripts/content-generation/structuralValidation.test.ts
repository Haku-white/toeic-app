import { describe, expect, it } from 'vitest'
import {
  validateAdditionalExplanationItemStructure,
  validateGrammarItemStructure,
  validateVocabItemStructure,
  wordPosKey,
} from './structuralValidation'

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

describe('validateGrammarItemStructure', () => {
  it('passes a well-formed item', () => {
    const result = validateGrammarItemStructure(validGrammarItem)
    expect(result.valid).toBe(true)
    expect(result.data?.question_text).toBe(validGrammarItem.question_text)
  })

  it('fails when Zod schema validation fails, with a readable error', () => {
    const result = validateGrammarItemStructure({ ...validGrammarItem, correct_index: 9 })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('correct_index')
  })

  it('detects duplicate choices after trim/lowercase normalization', () => {
    const result = validateGrammarItemStructure({
      ...validGrammarItem,
      choices: ['Submits', 'submits ', 'submitted', 'submitting'],
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('重複')
  })

  it('does not flag choices that only differ in case/whitespace differently (sanity: distinct choices pass)', () => {
    const result = validateGrammarItemStructure(validGrammarItem)
    expect(result.valid).toBe(true)
  })
})

describe('validateVocabItemStructure', () => {
  it('passes a well-formed, not-yet-registered item', () => {
    const result = validateVocabItemStructure(validVocabItem, new Set())
    expect(result.valid).toBe(true)
    expect(result.data?.word).toBe('negotiate')
  })

  it('fails when word+part_of_speech is already registered', () => {
    const existing = new Set([wordPosKey('negotiate', 'verb')])
    const result = validateVocabItemStructure(validVocabItem, existing)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('登録済み')
  })

  it('allows the same word with a different part_of_speech', () => {
    const existing = new Set([wordPosKey('negotiate', 'noun')])
    const result = validateVocabItemStructure(validVocabItem, existing)
    expect(result.valid).toBe(true)
  })

  it('fails Zod validation when etymology_note is missing', () => {
    const { etymology_note: _omit, ...withoutEtymology } = validVocabItem
    const result = validateVocabItemStructure(withoutEtymology, new Set())
    expect(result.valid).toBe(false)
  })
})

describe('validateAdditionalExplanationItemStructure (11.3)', () => {
  const validItem = {
    target_id: '123e4567-e89b-12d3-a456-426614174000',
    additional_explanation: 'よくある間違いの補足。',
  }

  it('passes a well-formed item', () => {
    const result = validateAdditionalExplanationItemStructure(validItem)
    expect(result.valid).toBe(true)
    expect(result.data?.target_id).toBe(validItem.target_id)
  })

  it('fails when target_id is not a UUID', () => {
    const result = validateAdditionalExplanationItemStructure({ ...validItem, target_id: 'not-a-uuid' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('target_id')
  })

  it('fails when additional_explanation is empty', () => {
    const result = validateAdditionalExplanationItemStructure({ ...validItem, additional_explanation: '' })
    expect(result.valid).toBe(false)
  })
})
