import { parseArgs } from './cliArgs'
import { generateJson, generateJsonArray } from './gemini'
import { generateVocabBatch } from './generateVocab'
import { validateBatch } from './validateBatch'
import { commitBatch } from './commitBatch'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * イディオムタグ（13.1のIDIOM_TAG_NAME、`vocab_tags`への事前seedは不要）を本格量
 * （30〜50語目安）までバッチ生成→検証→(auto_passedのみ)自動コミットする一回限りの
 * 実行用スクリプト。backfill_vocab_tags.tsと同じパターンだが、`generateVocabBatch`に
 * `contentKind: 'idiom'`を渡すためtagNameは不要（IDIOM_TAG_NAMEが自動的に使われる）。
 *
 * needs_reviewが1件でも出たバッチはコミットせず処理を中断する。
 * 使い方: npx tsx scripts/content-generation/backfill_idiom.ts [--skip N]
 */

const TARGET_BAND = 730
const COUNT_PER_BATCH = 20
// 2バッチ×20語=40語（既存0語と合わせて30〜50語の目安に収まる、backfill_vocab_tags.tsと同じ考え方）
const BATCH_COUNT = 2

interface BatchRunResult {
  requestedCount: number
  batchId: string
  generatedCount: number
  autoPassed: number
  needsReview: number
  committedCount: number
  failedCount: number
}

function printSummary(label: string, results: BatchRunResult[]) {
  console.log(`\n=== SUMMARY (${label}) ===`)
  console.log(JSON.stringify(results, null, 2))
  const totalGenerated = results.reduce((sum, r) => sum + r.generatedCount, 0)
  const totalCommitted = results.reduce((sum, r) => sum + r.committedCount, 0)
  const totalNeedsReview = results.reduce((sum, r) => sum + r.needsReview, 0)
  console.log(
    `\n合計: バッチ${results.length}件, 生成${totalGenerated}件, コミット${totalCommitted}件, ` +
      `needs_review${totalNeedsReview}件`,
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const skip = Number(args.skip ?? 0)
  const runs = Array.from({ length: BATCH_COUNT }, () => COUNT_PER_BATCH).slice(skip)
  console.log(`全${BATCH_COUNT}バッチ中、${skip}バッチをスキップして${runs.length}バッチを実行します。`)

  const supabase = createSupabaseAdminClient()
  const results: BatchRunResult[] = []

  try {
    for (const count of runs) {
      console.log(`\n=== イディオム / count=${count} ===`)

      const generated = await generateVocabBatch(
        { contentKind: 'idiom', count, targetBand: TARGET_BAND },
        { supabase, generateJsonArray },
      )
      console.log(`生成完了: batch_id=${generated.batchId}, ${generated.itemCount}件`)

      const validated = await validateBatch(generated.batchId, { supabase, generateJson })
      console.log(
        `検証完了: ${validated.total}件中 auto_passed=${validated.autoPassed}件, ` +
          `needs_review=${validated.needsReview}件`,
      )

      if (validated.needsReview > 0) {
        results.push({
          requestedCount: count,
          batchId: generated.batchId,
          generatedCount: generated.itemCount,
          autoPassed: validated.autoPassed,
          needsReview: validated.needsReview,
          committedCount: 0,
          failedCount: 0,
        })
        console.log(
          `\n!!! needs_reviewが${validated.needsReview}件発生したため処理を中断します。` +
            `\nbatch_id=${generated.batchId}（イディオム）は未コミットのままです。` +
            `\nnpx tsx scripts/content-generation/review_batch.ts --batch ${generated.batchId} でレビューしてください。`,
        )
        printSummary('STOPPED: needs_review', results)
        process.exitCode = 1
        return
      }

      const committed = await commitBatch(generated.batchId, { supabase })
      console.log(`反映完了: 成功=${committed.committedCount}件, 失敗=${committed.failedCount}件`)

      results.push({
        requestedCount: count,
        batchId: generated.batchId,
        generatedCount: generated.itemCount,
        autoPassed: validated.autoPassed,
        needsReview: validated.needsReview,
        committedCount: committed.committedCount,
        failedCount: committed.failedCount,
      })
    }
  } catch (error) {
    console.error('\n!!! 予期しないエラーが発生しました。処理を中断します。', error)
    printSummary('STOPPED: error', results)
    process.exitCode = 1
    return
  }

  printSummary('ALL COMPLETED', results)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
