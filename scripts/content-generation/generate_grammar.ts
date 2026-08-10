import { parseArgs } from './cliArgs'
import { generateJson } from './gemini'
import { generateGrammarBatch } from './generateGrammar'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 使い方:
 *   npx tsx scripts/content-generation/generate_grammar.ts \
 *     --category tense --count 10 --difficulty 3 --target-band 730
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const categoryCode = args.category
  if (!categoryCode) {
    throw new Error('--category <grammar_categories.code> は必須です（例: --category tense）')
  }

  const result = await generateGrammarBatch(
    {
      categoryCode,
      count: Number(args.count ?? 10),
      difficulty: Number(args.difficulty ?? 3),
      targetBand: Number(args['target-band'] ?? 730),
      promptVersion: args['prompt-version'],
      modelName: args.model,
    },
    { supabase: createSupabaseAdminClient(), generateJson },
  )

  console.log(`生成完了: batch_id=${result.batchId}, ${result.itemCount}件を generation_batch_items に保存しました。`)
  console.log(`次は検証を実行してください: npx tsx scripts/content-generation/validate_batch.ts --batch ${result.batchId}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
