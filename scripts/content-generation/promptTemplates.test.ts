import { describe, expect, it } from 'vitest'
import {
  buildGrammarPrompt,
  buildIdiomPrompt,
  buildVocabPrompt,
  GRAMMAR_JSON_SCHEMA,
  VOCAB_JSON_SCHEMA,
} from './promptTemplates'

describe('buildGrammarPrompt', () => {
  it('substitutes all placeholders and embeds the JSON schema', () => {
    const prompt = buildGrammarPrompt({
      categoryCode: 'tense',
      categoryNameJa: '時制',
      count: 3,
      difficulty: 2,
      targetBand: 730,
      existingQuestionSamples: ['She has worked here since 2020.'],
    })

    expect(prompt).toContain('文法問題を3問作成してください')
    expect(prompt).toContain('時制（tense）')
    expect(prompt).toContain('5段階中 2')
    expect(prompt).toContain('TOEIC 730点レベル目安')
    expect(prompt).toContain('- She has worked here since 2020.')
    expect(prompt).toContain(JSON.stringify(GRAMMAR_JSON_SCHEMA, null, 2))
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })

  it('falls back to a placeholder message when there are no existing samples', () => {
    const prompt = buildGrammarPrompt({
      categoryCode: 'tense',
      categoryNameJa: '時制',
      count: 1,
      difficulty: 1,
      targetBand: 600,
      existingQuestionSamples: [],
    })
    expect(prompt).toContain('（なし）')
  })
})

describe('buildVocabPrompt', () => {
  it('substitutes all placeholders and embeds the JSON schema', () => {
    const prompt = buildVocabPrompt({
      tagName: 'ビジネス',
      count: 5,
      targetBand: 860,
      existingWords: ['negotiate', 'reimburse'],
    })

    expect(prompt).toContain('カード情報を5件作成してください')
    expect(prompt).toContain('【テーマ】\nビジネス')
    expect(prompt).toContain('TOEIC 860点レベル')
    expect(prompt).toContain('tagsは常に["ビジネス"]のみ')
    expect(prompt).toContain('- negotiate')
    expect(prompt).toContain('- reimburse')
    expect(prompt).toContain(JSON.stringify(VOCAB_JSON_SCHEMA, null, 2))
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })
})

describe('buildIdiomPrompt', () => {
  it('substitutes all placeholders, covers both idioms and phrasal verbs, and embeds the vocab JSON schema (13.2)', () => {
    const prompt = buildIdiomPrompt({
      count: 5,
      targetBand: 730,
      existingWords: ['get the ball rolling'],
    })

    expect(prompt).toContain('イディオム（慣用表現）および句動詞（動詞+前置詞/副詞の組み合わせ）')
    expect(prompt).toContain('5件作成してください')
    expect(prompt).toContain('TOEIC 730点レベル')
    expect(prompt).toContain('look into, follow up on, run out of, come up with')
    expect(prompt).toContain('文学的な表現・くだけすぎた口語表現（スラング等）は避けて')
    expect(prompt).toContain('part_of_speechは、イディオムの場合"idiom"、句動詞の場合"phrasal verb"')
    expect(prompt).toContain('tagsは常に["イディオム"]のみ')
    expect(prompt).toContain('- get the ball rolling')
    expect(prompt).toContain(JSON.stringify(VOCAB_JSON_SCHEMA, null, 2))
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })

  it('falls back to a placeholder message when there are no existing idioms', () => {
    const prompt = buildIdiomPrompt({ count: 1, targetBand: 600, existingWords: [] })
    expect(prompt).toContain('（なし）')
  })
})
