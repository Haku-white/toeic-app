import { parseArgs } from './cliArgs'
import { generateJson } from './gemini'
import { generateVocabBatch } from './generateVocab'
import { validateBatch } from './validateBatch'
import { commitBatch } from './commitBatch'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 既存の語彙タグ「ビジネス」「日常会話」「Part7頻出」を、それぞれ本格量（30〜50問目安）まで
 * バッチ生成→検証→(auto_passedのみ)自動コミットする一回限りの実行用スクリプト（ユーザー指示）。
 * イディオム（13章）と同じ品質基準・パイプラインをそのまま利用する。
 *
 * needs_reviewが1件でも出たバッチはコミットせず処理を中断する。
 * 使い方: npx tsx scripts/content-generation/backfill_vocab_tags.ts [--skip N]
 */

const TARGET_BAND = 730
const COUNT_PER_BATCH = 20

interface RunSpec {
  tagName: string
  count: number
}

// 各タグ2バッチ×20語=40語ずつ新規生成（既存語と合わせて30〜50問の目安に収まる）
const ALL_RUNS: RunSpec[] = ['ビジネス', '日常会話', 'Part7頻出'].flatMap((tagName) => [
  { tagName, count: COUNT_PER_BATCH },
  { tagName, count: COUNT_PER_BATCH },
])

interface BatchRunResult {
  tagName: string
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
  const runs = ALL_RUNS.slice(skip)
  console.log(`全${ALL_RUNS.length}バッチ中、${skip}バッチをスキップして${runs.length}バッチを実行します。`)

  const supabase = createSupabaseAdminClient()
  const results: BatchRunResult[] = []

  try {
    for (const run of runs) {
      console.log(`\n=== ${run.tagName} / count=${run.count} ===`)

      const generated = await generateVocabBatch(
        { tagName: run.tagName, count: run.count, targetBand: TARGET_BAND },
        { supabase, generateJson },
      )
      console.log(`生成完了: batch_id=${generated.batchId}, ${generated.itemCount}件`)

      const validated = await validateBatch(generated.batchId, { supabase, generateJson })
      console.log(
        `検証完了: ${validated.total}件中 auto_passed=${validated.autoPassed}件, ` +
          `needs_review=${validated.needsReview}件`,
      )

      if (validated.needsReview > 0) {
        results.push({
          tagName: run.tagName,
          requestedCount: run.count,
          batchId: generated.batchId,
          generatedCount: generated.itemCount,
          autoPassed: validated.autoPassed,
          needsReview: validated.needsReview,
          committedCount: 0,
          failedCount: 0,
        })
        console.log(
          `\n!!! needs_reviewが${validated.needsReview}件発生したため処理を中断します。` +
            `\nbatch_id=${generated.batchId}（${run.tagName}）は未コミットのままです。` +
            `\nnpx tsx scripts/content-generation/review_batch.ts --batch ${generated.batchId} でレビューしてください。`,
        )
        printSummary('STOPPED: needs_review', results)
        process.exitCode = 1
        return
      }

      const committed = await commitBatch(generated.batchId, { supabase })
      console.log(`反映完了: 成功=${committed.committedCount}件, 失敗=${committed.failedCount}件`)

      results.push({
        tagName: run.tagName,
        requestedCount: run.count,
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
