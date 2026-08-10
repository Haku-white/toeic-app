import { config } from 'dotenv'

export interface ScriptEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** commit_batch.ts/review_batch.tsやvocabの検証など、Geminiを呼ばないスクリプトもあるため任意項目 */
  GEMINI_API_KEY: string | undefined
  GEMINI_MODEL: string
}

// SUPABASE_*はすべてのスクリプトで必須。GEMINI_API_KEYはgemini.tsのgenerateJson()で
// 実際に使う直前に検証する（commit_batch.ts等Geminiを呼ばないスクリプトを不要にブロックしないため）。
const REQUIRED_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

/**
 * `.env`（プロジェクトルート、gitignore済み）から必要な環境変数を読み込む。
 * ブラウザ向けの`VITE_*`とは別に、サーバー専用の値（service_roleキー・Gemini APIキー）を扱う。
 */
export function loadEnv(): ScriptEnv {
  config()

  const missing = REQUIRED_KEYS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `必要な環境変数が設定されていません: ${missing.join(', ')}\n` +
        'プロジェクトルートの.envに設定してください（DESIGN.md 8章参照）。',
    )
  }

  return {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  }
}
