import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const currentDir = dirname(fileURLToPath(import.meta.url))

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? values[key] : match))
}

/** `prompts/{name}.md`を読み込む（8.3・13.2参照） */
export function loadTemplate(name: 'grammar' | 'vocab' | 'idiom'): string {
  return readFileSync(join(currentDir, 'prompts', `${name}.md`), 'utf-8')
}

function formatSamples(samples: string[]): string {
  return samples.length > 0 ? samples.map((s) => `- ${s}`).join('\n') : '（なし）'
}

/** 8.3 文法問題の出力JSON Schema（Geminiの`responseSchema`にそのまま渡す） */
export const GRAMMAR_JSON_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      question_text: { type: 'STRING' },
      choices: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 4, maxItems: 4 },
      correct_index: { type: 'INTEGER' },
      explanation: { type: 'STRING' },
      difficulty: { type: 'INTEGER' },
      category_code: { type: 'STRING' },
    },
    required: ['question_text', 'choices', 'correct_index', 'explanation', 'difficulty', 'category_code'],
    propertyOrdering: ['question_text', 'choices', 'correct_index', 'explanation', 'difficulty', 'category_code'],
  },
} as const

/** 8.3 語彙の出力JSON Schema */
export const VOCAB_JSON_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      word: { type: 'STRING' },
      part_of_speech: { type: 'STRING' },
      meaning_ja: { type: 'STRING' },
      example_sentence_en: { type: 'STRING' },
      example_sentence_ja: { type: 'STRING' },
      toeic_band: { type: 'INTEGER' },
      etymology_note: { type: 'STRING' },
      tags: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: [
      'word',
      'part_of_speech',
      'meaning_ja',
      'example_sentence_en',
      'example_sentence_ja',
      'toeic_band',
      'etymology_note',
      'tags',
    ],
    propertyOrdering: [
      'word',
      'part_of_speech',
      'meaning_ja',
      'example_sentence_en',
      'example_sentence_ja',
      'toeic_band',
      'etymology_note',
      'tags',
    ],
  },
} as const

export interface BuildGrammarPromptParams {
  categoryCode: string
  categoryNameJa: string
  count: number
  difficulty: number
  targetBand: number
  existingQuestionSamples: string[]
}

export function buildGrammarPrompt(params: BuildGrammarPromptParams): string {
  return fillTemplate(loadTemplate('grammar'), {
    count: String(params.count),
    category_code: params.categoryCode,
    category_name_ja: params.categoryNameJa,
    difficulty: String(params.difficulty),
    target_band: String(params.targetBand),
    existing_question_samples: formatSamples(params.existingQuestionSamples),
    json_schema: JSON.stringify(GRAMMAR_JSON_SCHEMA, null, 2),
  })
}

export interface BuildVocabPromptParams {
  tagName: string
  count: number
  targetBand: number
  existingWords: string[]
}

export function buildVocabPrompt(params: BuildVocabPromptParams): string {
  return fillTemplate(loadTemplate('vocab'), {
    count: String(params.count),
    tag_name: params.tagName,
    target_band: String(params.targetBand),
    existing_words: formatSamples(params.existingWords),
    json_schema: JSON.stringify(VOCAB_JSON_SCHEMA, null, 2),
  })
}

export interface BuildIdiomPromptParams {
  count: number
  targetBand: number
  existingWords: string[]
}

/** 13.2: イディオム用プロンプト。出力形式はVOCAB_JSON_SCHEMAと同一（part_of_speechは"idiom"固定で生成させる） */
export function buildIdiomPrompt(params: BuildIdiomPromptParams): string {
  return fillTemplate(loadTemplate('idiom'), {
    count: String(params.count),
    target_band: String(params.targetBand),
    existing_words: formatSamples(params.existingWords),
    json_schema: JSON.stringify(VOCAB_JSON_SCHEMA, null, 2),
  })
}
