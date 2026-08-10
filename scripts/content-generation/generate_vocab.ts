import { parseArgs } from './cliArgs'
import { generateJson } from './gemini'
import { generateVocabBatch, type GenerateVocabBatchParams } from './generateVocab'
import { createSupabaseAdminClient } from './supabaseAdmin'

/**
 * 使い方:
 *   npx tsx scripts/content-generation/generate_vocab.ts \
 *     --tag ビジネス --count 15 --target-band 730
 *
 *   イディオムを生成する場合（13.2、--tagは不要）:
 *   npx tsx scripts/content-generation/generate_vocab.ts \
 *     --kind idiom --count 15 --target-band 730
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const contentKind: GenerateVocabBatchParams['contentKind'] = args.kind === 'idiom' ? 'idiom' : 'vocab'

  if (contentKind === 'vocab' && !args.tag) {
    throw new Error('--tag <vocab_tags.name> は必須です（例: --tag ビジネス。--kind idiom のときは不要）')
  }

  const result = await generateVocabBatch(
    {
      tagName: args.tag,
      contentKind,
      count: Number(args.count ?? 10),
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
