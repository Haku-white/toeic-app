import { z } from 'zod'

/** 8.3 文法問題のJSON Schemaに対応するZodスキーマ（①構造チェックで再検証する、8.4①） */
export const grammarItemSchema = z.object({
  question_text: z.string().min(1),
  choices: z.array(z.string().min(1)).length(4),
  correct_index: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  category_code: z.string().min(1),
})
export type GrammarItem = z.infer<typeof grammarItemSchema>

/** 8.3 語彙のJSON Schemaに対応するZodスキーマ */
export const vocabItemSchema = z.object({
  word: z.string().min(1),
  part_of_speech: z.string().min(1),
  meaning_ja: z.string().min(1),
  example_sentence_en: z.string().min(1),
  example_sentence_ja: z.string().min(1),
  toeic_band: z.number().int(),
  etymology_note: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
})
export type VocabItem = z.infer<typeof vocabItemSchema>

/**
 * 8.4③ 一意性セルフチェックの出力JSON Schemaに対応するZodスキーマ。
 * `reasoning`は判定手順（8.4③のプロンプト参照）の結論を常に記述させる必須項目——
 * needs_reviewになった際に人力レビュー（またはエージェントによる一次判断）が
 * セルフチェックの判断根拠をすぐ確認できるようにするため追加した（20260810）。
 * `ambiguity_reason`は`is_ambiguous`がtrueのときの補足説明で、こちらは引き続き任意。
 */
export const selfCheckResultSchema = z.object({
  reasoning: z.string().min(1),
  solved_index: z.number().int().min(0).max(3),
  is_ambiguous: z.boolean(),
  ambiguity_reason: z.string().optional(),
  confidence: z.number().min(0).max(1),
})
export type SelfCheckResult = z.infer<typeof selfCheckResultSchema>
