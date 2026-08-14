import { parseArgs } from './cliArgs'
import { generateJson, generateJsonArray } from './gemini'
import { runAutoBackfill, type AutoBackfillResult } from './autoBackfill'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 10章: 在庫（文法カテゴリごとのgrammar_questions件数・語彙タグごとのvocab_word_tags件数）が
 * 閾値を下回ったものを自動検出し、生成→検証→(auto_passedのみ)コミットまで自動実行する。
 * cron等の定期実行はスコープ外（10.11参照）——このCLIを手動実行する運用とする。
 *
 * 使い方:
 *   npm run backfill:auto -- [--dry-run] [--max-total 100] [--batch-size 8]
 *     [--concurrency 2] [--throttle-ms 1500]
 *     [--grammar-threshold 30] [--grammar-target 40]
 *     [--vocab-threshold 30] [--vocab-target 40] [--model gemini-3.7-flash]
 */
function printInventory(result: AutoBackfillResult) {
  console.log('\n=== 在庫チェック結果 ===')
  if (result.grammarInventory.length === 0 && result.vocabInventory.length === 0) {
    console.log('閾値未満のカテゴリ/タグはありません。')
    return
  }
  for (const c of result.grammarInventory) {
    console.log(`文法 [${c.categoryCode}] ${c.nameJa}: 現在${c.count}件 → 不足${c.shortfall}件`)
  }
  for (const t of result.vocabInventory) {
    console.log(`語彙 [${t.tagName}]: 現在${t.count}件 → 不足${t.shortfall}件`)
  }
}

function printSummary(result: AutoBackfillResult) {
  console.log('\n=== 実行結果 ===')
  console.log(JSON.stringify(result.tasks, null, 2))
  console.log(
    `\n合計: タスク${result.tasks.length}件, 生成${result.totalGenerated}件, ` +
      `コミット${result.totalCommitted}件, needs_review${result.totalNeedsReview}件`,
  )

  const needsReviewTasks = result.tasks.filter((t) => t.needsReview > 0)
  if (needsReviewTasks.length > 0) {
    console.log('\n--- needs_reviewが発生したタスク（10.10: 原因追跡用にラベル・バッチIDを明示） ---')
    for (const t of needsReviewTasks) {
      console.log(
        `[${t.kind}] ${t.label}: needs_review=${t.needsReview}件 (batch_ids: ${t.batchIds.join(', ')})\n` +
          `  レビュー: ${t.batchIds.map((id) => `npx tsx scripts/content-generation/review_batch.ts --batch ${id}`).join(' / ')}`,
      )
    }
  }

  const gaveUpTasks = result.tasks.filter((t) => t.gaveUpCount > 0)
  if (gaveUpTasks.length > 0) {
    console.log('\n--- バッチサイズ縮小を使い切っても生成できなかったタスク（次回実行時に再検出されます） ---')
    for (const t of gaveUpTasks) {
      console.log(`[${t.kind}] ${t.label}: ${t.gaveUpCount}件を諦めました`)
    }
  }

  if (result.skippedDueToMaxTotal.length > 0) {
    console.log('\n--- 1回あたりの生成上限(--max-total)により今回未着手のカテゴリ/タグ ---')
    for (const s of result.skippedDueToMaxTotal) {
      console.log(`[${s.kind}] ${s.label}: 不足${s.shortfall}件（次回実行時に再検出されます）`)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const result = await runAutoBackfill(
    { supabase: createSupabaseAdminClient(), generateJsonArray, generateJson },
    {
      dryRun: args['dry-run'] === 'true',
      maxTotal: args['max-total'] !== undefined ? Number(args['max-total']) : undefined,
      batchSize: args['batch-size'] !== undefined ? Number(args['batch-size']) : undefined,
      concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
      throttleMs: args['throttle-ms'] !== undefined ? Number(args['throttle-ms']) : undefined,
      grammarThreshold: args['grammar-threshold'] !== undefined ? Number(args['grammar-threshold']) : undefined,
      grammarTarget: args['grammar-target'] !== undefined ? Number(args['grammar-target']) : undefined,
      vocabThreshold: args['vocab-threshold'] !== undefined ? Number(args['vocab-threshold']) : undefined,
      vocabTarget: args['vocab-target'] !== undefined ? Number(args['vocab-target']) : undefined,
      modelName: args.model,
    },
  )

  printInventory(result)
  if (!result.dryRun) printSummary(result)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
