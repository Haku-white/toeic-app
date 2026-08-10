import { selfCheckResultSchema, type GrammarItem, type SelfCheckResult } from './schemas'
import type { generateJson as generateJsonFn } from './gemini'

/**
 * 8.4③ 一意性セルフチェックの出力JSON Schema。
 * `propertyOrdering`で`reasoning`を`solved_index`より前に生成させることで、
 * 「先に判定根拠を言語化してから結論（solved_index）を出す」という
 * プロンプト側の指示を構造化出力のレベルでも後押しする（20260810）。
 */
export const SELF_CHECK_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reasoning: { type: 'STRING' },
    solved_index: {
      type: 'INTEGER',
      description:
        '正解と判定した選択肢のインデックス。0始まり（プロンプトの選択肢一覧に付けた番号をそのまま使う。' +
        '1番目の選択肢はindex 0、2番目はindex 1、...）。',
    },
    is_ambiguous: { type: 'BOOLEAN' },
    ambiguity_reason: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['reasoning', 'solved_index', 'is_ambiguous', 'confidence'],
  propertyOrdering: ['reasoning', 'solved_index', 'is_ambiguous', 'ambiguity_reason', 'confidence'],
} as const

/**
 * 選択肢を0始まりのインデックス付きで列挙する。実データで、reasoningでは正しい選択肢を
 * 言葉で正しく結論づけているにもかかわらずsolved_indexの数値が1つずれる（1始まりと
 * 混同したとみられる）事例が見つかったため、選択肢自体にインデックスを明示することで
 * 「reasoningで選んだ語句」と「solved_indexの数値」の対応を取り違えにくくする（20260810）。
 */
function formatChoicesWithIndex(choices: string[]): string {
  return choices.map((choice, index) => `${index}: ${choice}`).join(' / ')
}

/**
 * 8.4③のプロンプト（正解を伏せて独立に解かせる）。
 * 実データで繰り返し観測されたセルフチェックの誤判定パターン（DESIGN.md 19章）——
 * ①前置詞と接続詞の混同（後続が節か句かの判断ミス）、②関係代名詞の格・種類の判断ミス、
 * ③仮定法・混合条件文の時制判断ミス——に対応する判定手順を明示的に指示する（20260810改訂）。
 */
export function buildSelfCheckPrompt(params: { questionText: string; choices: string[] }): string {
  return [
    '以下の英文の空所に入る最も適切な語句を、次の手順に従って判定してください。',
    '判定の過程は reasoning に簡潔に記述してから、結論を solved_index に反映してください。',
    '',
    '【判定手順】',
    '1. 空所の直後に続く文構造を先に特定する:',
    '   - 主語+動詞を含む完全な節（S+V...）が続くか',
    '   - 動詞を伴わない名詞句のみが続くか',
    '   を明示的に判定する。',
    '2. 各選択肢を機能で分類し、手順1の構造と両立するものだけを候補として残す:',
    '   - 接続詞・接続詞句（because, although, as if, except that 等）→ 完全な節を伴う',
    '   - 前置詞・前置詞句（because of, instead of, aside from, apart from 等）→ 名詞句を伴う',
    '     （名詞句の位置に主語+動詞を含む節を続けると非文法的になる点に注意）',
    '   - 接続副詞（however, nevertheless 等）→ 節を直接接続する機能はなく、コンマのみで',
    '     2つの節をつなぐと不適切（コンマスプライス）になる',
    '3. 選択肢に関係代名詞・関係副詞（who/whom/which/whose/whereby等）が含まれる場合は、',
    '   まず関係節内でその語が果たす役割を特定してから判断する:',
    '   - 節内の主語になっている → 主格（who 等）',
    '   - 動詞や前置詞の目的語になっている → 目的格（whom 等）',
    '   - 先行詞が人か物か（who/whom は人、which は物）',
    '   - 関係節がそれ自体で完全な文になっているか（完全な文の場合は関係代名詞ではなく',
    '     関係副詞 whereby 等が必要）',
    '4. 選択肢が仮定法・条件節に関わる動詞形（had + 過去分詞、would + 動詞原形等）を含む場合は、',
    '   文中の時制標識（last month、today、now、by then 等）から、いつの時点についての',
    '   非現実の仮定かを先に特定してから動詞形を判断する:',
    '   - 過去の事実に反する仮定 → 仮定法過去完了（had + 過去分詞）',
    '   - 現在の事実に反する仮定 → 仮定法過去',
    '   - 条件節と帰結節で時制標識が異なる場合（例: last month と today が混在）は、',
    '     それぞれの節で別々に判定する混合仮定法である可能性を考慮する',
    '5. 上記の判定を踏まえて最も適切な語句を1つ選び、他の選択肢がなぜ不適切かも判定してください。',
    '   solved_index には、以下の選択肢一覧に付けた番号（0始まり）をそのまま使ってください。',
    '',
    params.questionText,
    `選択肢: ${formatChoicesWithIndex(params.choices)}`,
    '',
    '複数の選択肢が文法的・意味的に成立し得る場合は is_ambiguous を true にしてください。',
  ].join('\n')
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8

/**
 * 8.4③の判定ロジック: solved_index一致 かつ 曖昧なし かつ confidenceが閾値以上、で auto_passed。
 * 副作用のない純粋関数として独立させ、単体テストしやすくしている。
 */
export function judgeSelfCheck(
  correctIndex: number,
  result: SelfCheckResult,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
): boolean {
  return result.solved_index === correctIndex && !result.is_ambiguous && result.confidence >= confidenceThreshold
}

export interface RunGrammarSelfCheckResult {
  passed: boolean
  payload: SelfCheckResult
}

/** Geminiへの2回目の呼び出し（正解を伏せて独立に解かせる）+ 判定 */
export async function runGrammarSelfCheck(
  item: Pick<GrammarItem, 'question_text' | 'choices' | 'correct_index'>,
  generateJson: typeof generateJsonFn,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
): Promise<RunGrammarSelfCheckResult> {
  const prompt = buildSelfCheckPrompt({ questionText: item.question_text, choices: item.choices })
  const raw = await generateJson<unknown>({ prompt, schema: SELF_CHECK_JSON_SCHEMA })
  const payload = selfCheckResultSchema.parse(raw)
  return { passed: judgeSelfCheck(item.correct_index, payload, confidenceThreshold), payload }
}
