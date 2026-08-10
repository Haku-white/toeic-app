import { parseArgs } from './cliArgs'
import { commitBatch } from './commitBatch'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 使い方:
 *   npx tsx scripts/content-generation/commit_batch.ts --batch <generation_batches.id>
 *
 * 8.6: auto_passed/approvedのアイテムをgrammar_questions/vocab_wordsへ反映する。
 * service_roleキーで実行することが前提（クライアント/ブラウザからは実行しない）。
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const batchId = args.batch
  if (!batchId) {
    throw new Error('--batch <generation_batches.id> は必須です')
  }

  const result = await commitBatch(batchId, { supabase: createSupabaseAdminClient() })

  console.log(`反映完了: 成功=${result.committedCount}件, 失敗（needs_reviewへ差し戻し）=${result.failedCount}件`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
