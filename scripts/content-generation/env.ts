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
 * 23.5: `.env`の運用は常にクラウドSupabaseプロジェクトを指す方針に統一した
 * （URLはクラウド・キーはクラウド向けsb_secret_、という組み合わせのはずが、以前
 * URLだけローカルのまま取り残されていたことがあり、ローカルSupabaseがエラーを出さず
 * 黙って空集合を返すという気づきにくい事故につながった）。この定数と一致しない場合は
 * 「意図しない接続先で動いている」可能性が高いため、起動時に必ず警告する。
 */
const KNOWN_CLOUD_PROJECT_URL = 'https://qpfmssdhbtlbudqburki.supabase.co'

// プロセス内でloadEnv()が複数回呼ばれても（generateGrammarBatch/generateVocabBatch等が
// 呼び出しごとに呼ぶため）、接続先ログ・警告は1回だけ出す。
let hasLoggedConnectionTarget = false

function logConnectionTarget(url: string): void {
  if (hasLoggedConnectionTarget) return
  hasLoggedConnectionTarget = true

  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)
  if (url === KNOWN_CLOUD_PROJECT_URL) {
    console.log(`[env] Supabase接続先: クラウド (${url})`)
  } else if (isLocal) {
    console.warn(
      `[env] ⚠️  Supabase接続先: ローカル (${url})。通常運用は常にクラウドを使う方針です（DESIGN.md 23章参照）。` +
        'スキーマ動作確認など意図的にローカルへ向けている場合のみ問題ありません。',
    )
  } else {
    console.warn(
      `[env] ⚠️  Supabase接続先が想定外のURLです: ${url}` +
        `（DESIGN.md 23章のクラウドプロジェクトURL "${KNOWN_CLOUD_PROJECT_URL}" と一致しません）`,
    )
  }
}

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

  logConnectionTarget(process.env.SUPABASE_URL!)

  return {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  }
}
