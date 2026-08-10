import { createInterface } from 'node:readline/promises'
import { parseArgs } from './cliArgs'
import { applyReviewDecision, fetchNeedsReviewItems } from './reviewBatch'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 使い方:
 *   npx tsx scripts/content-generation/review_batch.ts --batch <generation_batches.id> [--reviewer <auth.users.id>]
 *
 * 8.5: needs_reviewのアイテムを1件ずつ表示し、a(承認)/r(却下)/s(スキップ)で判定する。
 * 専用UIは作らず軽量なCLIで運用する（将来量が増えればweak-pointsと同じReact基盤に移行予定）。
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const batchId = args.batch
  if (!batchId) {
    throw new Error('--batch <generation_batches.id> は必須です')
  }
  const reviewerId = args.reviewer ?? null

  const supabase = createSupabaseAdminClient()
  const items = await fetchNeedsReviewItems(supabase, batchId)

  if (items.length === 0) {
    console.log('needs_reviewのアイテムはありません。')
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    let approved = 0
    let rejected = 0
    let skipped = 0

    for (const [index, item] of items.entries()) {
      console.log(`\n--- [${index + 1}/${items.length}] item_id=${item.id} ---`)
      console.log('raw_payload:', JSON.stringify(item.raw_payload, null, 2))
      console.log('validation_errors:', JSON.stringify(item.validation_errors, null, 2))
      console.log('self_check_payload:', JSON.stringify(item.self_check_payload, null, 2))

      const answer = (await rl.question('承認[a] / 却下[r] / スキップ[s]: ')).trim().toLowerCase()
      if (answer === 'a') {
        const notes = await rl.question('メモ（任意、Enterで省略）: ')
        await applyReviewDecision(supabase, item.id, { decision: 'approved', reviewerId, notes: notes || null })
        approved += 1
      } else if (answer === 'r') {
        const notes = await rl.question('却下理由（任意、Enterで省略）: ')
        await applyReviewDecision(supabase, item.id, { decision: 'rejected', reviewerId, notes: notes || null })
        rejected += 1
      } else {
        skipped += 1
      }
    }

    console.log(`\nレビュー完了: 承認=${approved}件, 却下=${rejected}件, スキップ=${skipped}件`)
    if (skipped === 0) {
      console.log(`本番反映できます: npx tsx scripts/content-generation/commit_batch.ts --batch ${batchId}`)
    }
  } finally {
    rl.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
