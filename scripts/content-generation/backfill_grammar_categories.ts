import { parseArgs } from './cliArgs'
import { generateJson, generateJsonArray } from './gemini'
import { generateGrammarBatch } from './generateGrammar'
import { validateBatch } from './validateBatch'
import { commitBatch } from './commitBatch'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 9カテゴリ中tense以外の8カテゴリについて、難易度3×15問・4×15問・5×10問（計40問/カテゴリ、
 * 8カテゴリで計320問）をバッチ生成→検証→(auto_passedのみ)自動コミットまで一括実行する
 * 一回限りの実行用スクリプト（ユーザー指示、DESIGN.md 8章のパイプラインをそのまま利用）。
 *
 * needs_reviewが1件でも出たバッチがあれば、そのバッチは意図的にコミットせず処理を中断する
 * （「自動コミットはauto_passedのみに限定」というユーザー指示のため）。予期しないエラーが
 * 発生した場合も同様に、その時点までの結果を出力して中断する。
 *
 * needs_reviewで中断した後の運用（ユーザー指示）: 文法的に明確に判断できるケースは
 * review_batch.ts相当の判断（applyReviewDecision）で承認/却下しコミットしてから、
 * `--skip N`で完了済みの(カテゴリ×難易度)組を読み飛ばして再開する。本当に曖昧なケースのみ
 * ユーザーにエスカレートする（17章の未決事項に運用方針として記録済み）。
 *
 * 使い方: npx tsx scripts/content-generation/backfill_grammar_categories.ts [--skip N]
 */

const CATEGORIES = [
  'conjunction',
  'subjunctive',
  'relative_clause',
  'comparison',
  'voice',
  'infinitive_gerund',
  'preposition',
  'part_of_speech',
]

const DIFFICULTY_TIERS = [
  { difficulty: 3, count: 15 },
  { difficulty: 4, count: 15 },
  { difficulty: 5, count: 10 },
]

const TARGET_BAND = 730

interface RunSpec {
  categoryCode: string
  difficulty: number
  count: number
}

const ALL_RUNS: RunSpec[] = CATEGORIES.flatMap((categoryCode) =>
  DIFFICULTY_TIERS.map((tier) => ({ categoryCode, difficulty: tier.difficulty, count: tier.count })),
)

interface BatchRunResult {
  categoryCode: string
  difficulty: number
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
      console.log(`\n=== ${run.categoryCode} / difficulty=${run.difficulty} / count=${run.count} ===`)

      const generated = await generateGrammarBatch(
        { categoryCode: run.categoryCode, count: run.count, difficulty: run.difficulty, targetBand: TARGET_BAND },
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
          categoryCode: run.categoryCode,
          difficulty: run.difficulty,
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
            `\nbatch_id=${generated.batchId}（${run.categoryCode} / difficulty=${run.difficulty}）は未コミットのままです。` +
            `\nnpx tsx scripts/content-generation/review_batch.ts --batch ${generated.batchId} でレビューしてください。`,
        )
        printSummary('STOPPED: needs_review', results)
        process.exitCode = 1
        return
      }

      const committed = await commitBatch(generated.batchId, { supabase })
      console.log(`反映完了: 成功=${committed.committedCount}件, 失敗=${committed.failedCount}件`)

      results.push({
        categoryCode: run.categoryCode,
        difficulty: run.difficulty,
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
