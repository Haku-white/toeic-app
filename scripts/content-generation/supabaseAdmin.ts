import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from './env'

/**
 * service_roleキーを使う管理者クライアント。RLSを完全にバイパスするため、
 * ブラウザ向けの`src/lib/supabase.ts`（anonキー）とは明確に分離している。
 * このモジュールはNode専用スクリプト（scripts/content-generation/配下）からのみ利用する。
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const env = loadEnv()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}
