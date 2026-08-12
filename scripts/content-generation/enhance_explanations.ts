import { parseArgs } from './cliArgs'
import { generateJson, generateJsonArray } from './gemini'
import { runExplanationEnhancement, type EnhanceExplanationsResult } from './enhanceExplanations'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 11章: 正答率/記憶定着率が低い問題・単語を自動検出し、既存の解説を上書きせず追加解説
 * （additional_explanation）を生成→検証→(auto_passedのみ)コミットまで自動実行する。
 * cron等の定期実行はスコープ外（11.5参照）——このCLIを手動実行する運用とする。
 *
 * 使い方:
 *   npm run enhance:explanations -- [--dry-run] [--max-total 50] [--batch-size 8]
 *     [--concurrency 2] [--throttle-ms 1500]
 *     [--grammar-min-attempts 5] [--grammar-max-accuracy 0.7]
 *     [--vocab-min-reviews 5] [--vocab-min-again-rate 0.3] [--model gemini-3.6-flash]
 */
function printTargets(result: EnhanceExplanationsResult) {
  console.log('\n=== 対象抽出結果 ===')
  if (result.weakGrammar.length === 0 && result.weakVocab.length === 0) {
    console.log('該当する問題/単語はありません。')
    return
  }
  console.log(`文法: ${result.weakGrammar.length}件（正答率が低く追加解説が未設定のもの）`)
  console.log(`語彙: ${result.weakVocab.length}件（again率が高く追加解説が未設定のもの）`)
}

function printSummary(result: EnhanceExplanationsResult) {
  console.log('\n=== 実行結果 ===')
  console.log(JSON.stringify(result.tasks, null, 2))
  console.log(
    `\n合計: タスク${result.tasks.length}件, 追加解説を反映${result.totalEnhanced}件, ` +
      `needs_review${result.totalNeedsReview}件`,
  )

  const needsReviewTasks = result.tasks.filter((t) => t.needsReview > 0)
  if (needsReviewTasks.length > 0) {
    console.log('\n--- needs_reviewが発生したタスク ---')
    for (const t of needsReviewTasks) {
      console.log(
        `[${t.kind}] needs_review=${t.needsReview}件 (batch_ids: ${t.batchIds.join(', ')})\n` +
          `  レビュー: ${t.batchIds.map((id) => `npx tsx scripts/content-generation/review_batch.ts --batch ${id}`).join(' / ')}`,
      )
    }
  }

  const gaveUpTasks = result.tasks.filter((t) => t.gaveUpCount > 0)
  if (gaveUpTasks.length > 0) {
    console.log('\n--- バッチサイズ縮小を使い切っても生成できなかったタスク（次回実行時に再検出されます） ---')
    for (const t of gaveUpTasks) {
      console.log(`[${t.kind}]: ${t.gaveUpCount}件を諦めました`)
    }
  }

  if (result.grammarSkippedCount > 0 || result.vocabSkippedCount > 0) {
    console.log('\n--- 1回あたりの対象件数上限(--max-total)により今回未着手 ---')
    if (result.grammarSkippedCount > 0) console.log(`文法: ${result.grammarSkippedCount}件`)
    if (result.vocabSkippedCount > 0) console.log(`語彙: ${result.vocabSkippedCount}件`)
    console.log('（次回実行時に再検出されます）')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const result = await runExplanationEnhancement(
    { supabase: createSupabaseAdminClient(), generateJsonArray, generateJson },
    {
      dryRun: args['dry-run'] === 'true',
      maxTotal: args['max-total'] !== undefined ? Number(args['max-total']) : undefined,
      batchSize: args['batch-size'] !== undefined ? Number(args['batch-size']) : undefined,
      concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
      throttleMs: args['throttle-ms'] !== undefined ? Number(args['throttle-ms']) : undefined,
      grammarMinAttempts: args['grammar-min-attempts'] !== undefined ? Number(args['grammar-min-attempts']) : undefined,
      grammarMaxAccuracy: args['grammar-max-accuracy'] !== undefined ? Number(args['grammar-max-accuracy']) : undefined,
      vocabMinReviews: args['vocab-min-reviews'] !== undefined ? Number(args['vocab-min-reviews']) : undefined,
      vocabMinAgainRate: args['vocab-min-again-rate'] !== undefined ? Number(args['vocab-min-again-rate']) : undefined,
      modelName: args.model,
    },
  )

  printTargets(result)
  if (!result.dryRun) printSummary(result)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
