import { parseArgs } from './cliArgs'
import { generateJson, generateJsonArray } from './gemini'
import { createSupabaseAdminClient } from './supabaseAdmin'
import { runCefrjImport } from './runCefrjImport'

/**
 * CEFR-J Wordlist（21章）から単語選定候補を抽出し、既存パイプライン（サブバッチ分割・
 * concurrencyPoolでの並列実行・段階的バッチサイズ縮小、10章・11.4を再利用）で
 * generateVocabBatchFromWordlist→validate_batch→commit_batchまで自動実行する（21.9）。
 *
 * 使い方:
 *   npx tsx scripts/content-generation/import_cefrj_wordlist.ts \
 *     [--limit 300] [--levels B1,B2] [--batch-size 8] [--concurrency 2] \
 *     [--throttle-ms 1500] [--model ...] [--csv ...] [--dry-run]
 *
 * --limitは1回あたりの生成上限（既定300、DESIGN.md 21.9参照。既に処理済みの語も含めた
 * 累計を意識する場合は、呼び出し側で残り件数を計算して渡すこと）。
 * --dry-runを指定すると候補語の抽出・選定結果のみ表示し、Gemini API呼び出し・DB書き込みは行わない。
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dryRun = args['dry-run'] === 'true'

  const levels = args.levels ? args.levels.split(',').map((s) => s.trim().toUpperCase()) : undefined
  const maxTotal = args.limit ? Number(args.limit) : args['max-total'] ? Number(args['max-total']) : undefined
  if (maxTotal !== undefined && (!Number.isInteger(maxTotal) || maxTotal <= 0)) {
    throw new Error(`--limit/--max-total は正の整数で指定してください: ${args.limit ?? args['max-total']}`)
  }

  const result = await runCefrjImport(
    { supabase: createSupabaseAdminClient(), generateJsonArray, generateJson },
    {
      levels,
      maxTotal,
      batchSize: args['batch-size'] ? Number(args['batch-size']) : undefined,
      concurrency: args.concurrency ? Number(args.concurrency) : undefined,
      throttleMs: args['throttle-ms'] ? Number(args['throttle-ms']) : undefined,
      modelName: args.model,
      dryRun,
    },
  )

  if (result.dryRun) {
    console.log(`候補: ${result.totalCandidates}語中、今回選定: ${result.selectedCount}語（--dry-runのため生成は行いません）`)
    return
  }

  console.log(
    `候補: ${result.totalCandidates}語中、今回選定: ${result.selectedCount}語を${result.chunks.length}サブバッチで処理しました。`,
  )
  console.log(
    `生成${result.totalGenerated}件 / コミット${result.totalCommitted}件 / needs_review${result.totalNeedsReview}件` +
      (result.totalGaveUp > 0 ? ` / 生成断念${result.totalGaveUp}件` : ''),
  )
  for (const chunk of result.chunks) {
    console.log(
      `  batch(es) ${chunk.batchIds.join(',') || '(none)'}: 依頼${chunk.requestedCount}件, ` +
        `生成${chunk.generatedCount}件, auto_passed=${chunk.autoPassed}, needs_review=${chunk.needsReview}, ` +
        `コミット${chunk.committedCount}件` +
        (chunk.gaveUpCount > 0 ? `, 断念${chunk.gaveUpCount}件` : ''),
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
