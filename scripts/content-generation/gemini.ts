import { ApiError, FinishReason, GoogleGenAI } from '@google/genai'
import { loadEnv } from './env'

export interface GenerateJsonParams {
  prompt: string
  /** Gemini responseSchema（8.3/8.4の各JSON Schema） */
  schema: Record<string, unknown>
  model?: string
}

let cachedClient: GoogleGenAI | null = null

function getClient(apiKey: string): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey })
  }
  return cachedClient
}

/**
 * 17章の未決事項「Gemini API失敗時のリトライ戦略」への対応。
 * 429（レート制限）・5xx（一時的な過負荷等）はリトライ対象、それ以外（400等のリクエスト自体の
 * 誤り、認証エラー等）は即座に失敗させる——リトライしても解決しないエラーまで待たせないため。
 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])
/**
 * `fetch`自体が失敗した場合（`TypeError: fetch failed`、実際の原因は`.cause.code`に入る）の
 * うちリトライ対象とするネットワークエラーコード。実データでバックフィル中に`ECONNRESET`が
 * 複数回発生し、ApiError（HTTPステータスを持つ）のみを対象にしていた従来の判定では拾えず、
 * 良質な生成結果が「予期しないエラー」としてneeds_reviewに落ちてしまっていたため追加した（20260810）。
 */
const RETRYABLE_NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'])
const MAX_RETRIES = 5
const BASE_DELAY_MS = 3000

/**
 * 429/5xx・リトライ対象ネットワークエラーかどうかを判定する。10章の自動補充
 * オーケストレーター（`autoBackfill.ts`）が「gemini.ts内の5回リトライを使い切った末の
 * 過負荷エラーかどうか」を見分けてバッチサイズ縮小リトライ（10.7）を行うかどうかの
 * 判断に再利用するため、モジュール外にも公開する。
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) return RETRYABLE_STATUS_CODES.has(error.status)

  const cause = error instanceof Error ? error.cause : undefined
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code?: unknown }).code
    return typeof code === 'string' && RETRYABLE_NETWORK_ERROR_CODES.has(code)
  }
  return false
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return `status=${error.status}`
  const cause = error instanceof Error ? error.cause : undefined
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return `network error: ${String((cause as { code?: unknown }).code)}`
  }
  return String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface RawGenerateResult {
  text: string
  finishReason?: FinishReason
}

/**
 * Gemini API呼び出し+リトライ・バックオフの共通部分。`generateJson`（単一オブジェクト用）と
 * `generateJsonArray`（10.6: バッチ配列用、切り詰め検知・部分救済に対応）の両方から使う。
 */
async function callGeminiWithRetry(params: GenerateJsonParams): Promise<RawGenerateResult> {
  const env = loadEnv()
  if (!env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY が設定されていません。プロジェクトルートの.envに設定してください（DESIGN.md 8章参照）。',
    )
  }
  const ai = getClient(env.GEMINI_API_KEY)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: params.model ?? env.GEMINI_MODEL,
        contents: params.prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: params.schema,
        },
      })

      const text = response.text
      if (!text) {
        throw new Error('Gemini APIから空のレスポンスが返されました')
      }

      return { text, finishReason: response.candidates?.[0]?.finishReason }
    } catch (error) {
      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error
      }
      const delayMs = BASE_DELAY_MS * 2 ** attempt
      console.warn(
        `Gemini API呼び出しで一時的なエラー（${describeError(error)}）が発生しました。` +
          `${delayMs}ms待って再試行します（${attempt + 1}/${MAX_RETRIES}回目）...`,
      )
      await sleep(delayMs)
    }
  }
  // MAX_RETRIES>=0である限りループ内で必ずreturn/throwするため到達しないが、型を満たすために置く
  throw new Error('unreachable')
}

/**
 * Gemini APIをresponseSchema付きで呼び出し、パース済みJSONを返す。
 * 8.3/8.4の各生成・検証ステップはこの関数だけを通じてGemini APIに触れる
 * （テストではこのモジュール全体をモックし、実APIを呼ばない）。
 * 単一オブジェクト用（一意性セルフチェック等）。バッチ配列の生成には`generateJsonArray`を使う。
 */
export async function generateJson<T = unknown>(params: GenerateJsonParams): Promise<T> {
  const { text } = await callGeminiWithRetry(params)
  return JSON.parse(text) as T
}

/**
 * トップレベルが配列のJSON文字列から、完結している要素だけを部分的に取り出す
 * （10.6・10.8/9対応）。出力トークン上限で末尾が途中で切れている場合でも、
 * それより前の完結した要素は救済し、不完全な末尾要素のみを破棄する。
 * 文字列内のエスケープ・ネストしたオブジェクト/配列（`choices`配列等）を
 * 深さトラッキングで正しく無視する軽量なスキャナ（外部ライブラリは使わない）。
 */
export function extractCompleteArrayItems(text: string): unknown[] {
  const start = text.indexOf('[')
  if (start === -1) return []

  let depth = 0
  let inString = false
  let escaped = false
  let itemStart = -1
  const items: unknown[] = []

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      if (depth === 1 && itemStart === -1) itemStart = i
      depth += 1
      continue
    }
    if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 1 && itemStart !== -1) {
        const candidate = text.slice(itemStart, i + 1)
        try {
          items.push(JSON.parse(candidate))
        } catch {
          // 不完全な要素（末尾が途中で切れている等）は破棄する
        }
        itemStart = -1
      }
      continue
    }
  }
  return items
}

export interface GenerateJsonArrayResult<T> {
  items: T[]
  /** finishReasonがMAX_TOKENS（出力トークン上限による途中切れの可能性、10.6/10.9） */
  truncated: boolean
  /** JSON.parseがそのまま失敗し、extractCompleteArrayItemsによる部分救済を使ったか */
  parseRecovered: boolean
}

/**
 * バッチ配列（8.3のGRAMMAR_JSON_SCHEMA/VOCAB_JSON_SCHEMA）用のGemini呼び出し。
 * 10.6: JSON.parseが失敗した場合は即座に例外を投げず、完結している要素だけを
 * extractCompleteArrayItemsで部分救済する。呼び出し元（generateGrammarBatch/
 * generateVocabBatch）はtruncated/parseRecoveredを見てgeneration_batches.notesに
 * 記録し、不足分は10.4のオーケストレーターが後続のサブバッチ生成で埋め合わせる。
 */
export async function generateJsonArray<T = unknown>(params: GenerateJsonParams): Promise<GenerateJsonArrayResult<T>> {
  const { text, finishReason } = await callGeminiWithRetry(params)
  const truncated = finishReason === FinishReason.MAX_TOKENS

  try {
    const items = JSON.parse(text) as T[]
    return { items, truncated, parseRecovered: false }
  } catch {
    const items = extractCompleteArrayItems(text) as T[]
    return { items, truncated, parseRecovered: true }
  }
}
