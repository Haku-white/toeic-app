import { ApiError, GoogleGenAI } from '@google/genai'
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

function isRetryableError(error: unknown): boolean {
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

/**
 * Gemini APIをresponseSchema付きで呼び出し、パース済みJSONを返す。
 * 8.3/8.4の各生成・検証ステップはこの関数だけを通じてGemini APIに触れる
 * （テストではこのモジュール全体をモックし、実APIを呼ばない）。
 */
export async function generateJson<T = unknown>(params: GenerateJsonParams): Promise<T> {
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

      return JSON.parse(text) as T
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
