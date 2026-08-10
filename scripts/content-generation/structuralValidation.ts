import { grammarItemSchema, vocabItemSchema, type GrammarItem, type VocabItem } from './schemas'

export interface StructuralValidationResult<T> {
  valid: boolean
  errors: string[]
  data?: T
}

function normalizeChoice(choice: string): string {
  return choice.trim().toLowerCase()
}

/** 8.4① 文法問題の構造チェック: Zodスキーマ + 選択肢の正規化後重複チェック */
export function validateGrammarItemStructure(raw: unknown): StructuralValidationResult<GrammarItem> {
  const parsed = grammarItemSchema.safeParse(raw)
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
  }

  const normalized = parsed.data.choices.map(normalizeChoice)
  const uniqueCount = new Set(normalized).size
  if (uniqueCount !== normalized.length) {
    return { valid: false, errors: ['choices: 正規化(trim・小文字化)後に重複する選択肢があります'] }
  }

  return { valid: true, errors: [], data: parsed.data }
}

/** 8.4① 語彙の構造チェック: Zodスキーマ + (word, part_of_speech)の重複チェック */
export function validateVocabItemStructure(
  raw: unknown,
  existingWordPosPairs: ReadonlySet<string>,
): StructuralValidationResult<VocabItem> {
  const parsed = vocabItemSchema.safeParse(raw)
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
  }

  const key = wordPosKey(parsed.data.word, parsed.data.part_of_speech)
  if (existingWordPosPairs.has(key)) {
    return { valid: false, errors: [`word+part_of_speech: "${parsed.data.word}" (${parsed.data.part_of_speech}) は既に登録済みです`] }
  }

  return { valid: true, errors: [], data: parsed.data }
}

export function wordPosKey(word: string, partOfSpeech: string | null): string {
  return `${word}|${partOfSpeech ?? ''}`
}
