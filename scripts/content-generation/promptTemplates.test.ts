import { describe, expect, it } from 'vitest'
import {
  ADDITIONAL_EXPLANATION_JSON_SCHEMA,
  buildGrammarAdditionalExplanationPrompt,
  buildGrammarPrompt,
  buildIdiomPrompt,
  buildVocabAdditionalExplanationPrompt,
  buildVocabFromWordlistPrompt,
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

describe('buildVocabFromWordlistPrompt (21.5)', () => {
  it('substitutes the word list, merged CEFR levels, target band, and embeds the vocab JSON schema', () => {
    const prompt = buildVocabFromWordlistPrompt({
      words: [
        { word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' },
        { word: 'abandoned', partOfSpeech: 'adjective', cefrLevel: 'B2' },
      ],
      targetBand: 660,
      existingWords: ['negotiate'],
    })

    expect(prompt).toContain('CEFRレベル: B1/B2')
    expect(prompt).toContain('TOEIC目安 660点前後')
    expect(prompt).toContain('- abandon (verb, CEFR B1)')
    expect(prompt).toContain('- abandoned (adjective, CEFR B2)')
    expect(prompt).toContain('- negotiate')
    expect(prompt).toContain('"ビジネス"')
    expect(prompt).toContain('"日常会話"')
    expect(prompt).toContain('"Part7頻出"')
    expect(prompt).toContain('新しい単語を創作したり')
    expect(prompt).toContain('The CEFR-J Wordlist Version 1.5')
    expect(prompt).toContain(JSON.stringify(VOCAB_JSON_SCHEMA, null, 2))
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })

  it('falls back to a placeholder message when there are no existing words', () => {
    const prompt = buildVocabFromWordlistPrompt({
      words: [{ word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' }],
      targetBand: 600,
      existingWords: [],
    })
    expect(prompt).toContain('（なし）')
  })

  it('deduplicates repeated CEFR levels in the header', () => {
    const prompt = buildVocabFromWordlistPrompt({
      words: [
        { word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' },
        { word: 'able', partOfSpeech: 'adjective', cefrLevel: 'B1' },
      ],
      targetBand: 600,
      existingWords: [],
    })
    expect(prompt).toContain('CEFRレベル: B1、')
  })
})

describe('buildGrammarAdditionalExplanationPrompt (11.3)', () => {
  it('embeds the item count, items as JSON with target_id, and the JSON schema', () => {
    const prompt = buildGrammarAdditionalExplanationPrompt({
      items: [
        {
          targetId: 'q-1',
          question_text: 'The company ___ its report by Friday.',
          accuracy_rate: 0.5,
          attempt_count: 8,
        },
      ],
    })

    expect(prompt).toContain('文法問題1件です')
    expect(prompt).toContain('"target_id": "q-1"')
    expect(prompt).toContain('"question_text": "The company ___ its report by Friday."')
    expect(prompt).toContain(JSON.stringify(ADDITIONAL_EXPLANATION_JSON_SCHEMA, null, 2))
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })
})

describe('buildVocabAdditionalExplanationPrompt (11.3)', () => {
  it('embeds the item count, items as JSON with target_id, and the JSON schema', () => {
    const prompt = buildVocabAdditionalExplanationPrompt({
      items: [{ targetId: 'v-1', word: 'negotiate', again_rate: 0.4, review_count: 6 }],
    })

    expect(prompt).toContain('単語1件です')
    expect(prompt).toContain('"target_id": "v-1"')
    expect(prompt).toContain('"word": "negotiate"')
    expect(prompt).toContain(JSON.stringify(ADDITIONAL_EXPLANATION_JSON_SCHEMA, null, 2))
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })
})
