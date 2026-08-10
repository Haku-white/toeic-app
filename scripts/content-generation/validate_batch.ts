import { parseArgs } from './cliArgs'
import { generateJson } from './gemini'
import { validateBatch } from './validateBatch'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 使い方:
 *   npx tsx scripts/content-generation/validate_batch.ts --batch <generation_batches.id>
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const batchId = args.batch
  if (!batchId) {
    throw new Error('--batch <generation_batches.id> は必須です')
  }

  const result = await validateBatch(batchId, {
    supabase: createSupabaseAdminClient(),
    generateJson,
    similarityThreshold: args['similarity-threshold'] ? Number(args['similarity-threshold']) : undefined,
    confidenceThreshold: args['confidence-threshold'] ? Number(args['confidence-threshold']) : undefined,
  })

  // result.total（pending_validationとして実際に処理した件数）が0のとき、
  // 「このバッチには既に検証対象が残っていない（既に検証済み）」のか
  // 「このバッチ自体にアイテムが無い（バッチID指定ミス・生成処理の中断等）」のかを
  // totalItemsInBatchで区別して伝える。両者を区別せず「0件中auto_passed=0件」とだけ
  // 出力すると、実際には既に検証・コミット済みの正常なバッチに対して再実行しただけでも
  // 「何も検証できなかった」ように見えてしまい紛らわしいため。
  if (result.total === 0) {
    if (result.totalItemsInBatch === 0) {
      console.log(
        `対象0件です: バッチ「${batchId}」にgeneration_batch_itemsが1件もありません。` +
          `バッチIDの指定ミス、または生成処理（generate_grammar.ts / generate_vocab.ts）が` +
          `完了する前に中断された可能性があります。`,
      )
    } else {
      console.log(
        `対象0件で正常終了しました: このバッチの${result.totalItemsInBatch}件は既に検証済みです` +
          `（pending_validation状態のアイテムが残っていません）。再度の検証は不要です。`,
      )
    }
    return
  }

  console.log(
    `検証完了: ${result.total}件中 auto_passed=${result.autoPassed}件, needs_review=${result.needsReview}件`,
  )
  if (result.needsReview > 0) {
    console.log(
      `人力レビューが必要です: npx tsx scripts/content-generation/review_batch.ts --batch ${batchId}`,
    )
  } else {
    console.log(
      `本番反映できます: npx tsx scripts/content-generation/commit_batch.ts --batch ${batchId}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
