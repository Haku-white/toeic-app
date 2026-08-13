import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseArgs } from './cliArgs'
import { generateJsonArray } from './gemini'
import { createSupabaseAdminClient } from './supabaseAdmin'
import { loadExistingVocabWordPosPairs } from './validateBatch'
import { CEFR_TO_TOEIC_BAND, excludeExistingCandidates, filterCefrjCandidates, parseCefrjCsv } from './cefrjWordlist'
import { generateVocabBatchFromWordlist } from './generateVocab'

const currentDir = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CSV_PATH = join(currentDir, 'data', 'cefrj-vocabulary-profile-1.5.csv')

/**
 * CEFR-J Wordlist（21章）から単語選定候補を抽出し、既存パイプライン
 * （generateVocabBatchFromWordlist→validate_batch.ts→review_batch.ts→commit_batch.ts）に
 * 投入する。単語選定はこのスクリプトが行い、日本語訳・例文・語源解説の生成はGeminiに委ねる
 * （21.3の役割分担）。
 *
 * 使い方:
 *   npx tsx scripts/content-generation/import_cefrj_wordlist.ts \
 *     --limit 25 [--levels B1,B2] [--target-band 730] [--dry-run] [--model ...] [--csv ...]
 *
 * --limitは必須（21.5: 数千語規模の候補を誤って一度に投入しないための安全策）。
 * --dry-runを指定すると候補語の抽出結果を表示するのみで、Gemini API呼び出し・DB書き込みは行わない。
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.limit) {
    throw new Error('--limit は必須です（例: --limit 25。大量投入を避けるための安全策、DESIGN.md 21.5参照）')
  }
  const limit = Number(args.limit)
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`--limit は正の整数で指定してください: ${args.limit}`)
  }

  const levels = (args.levels ?? 'B1,B2').split(',').map((s) => s.trim().toUpperCase())
  for (const level of levels) {
    if (!(level in CEFR_TO_TOEIC_BAND)) {
      throw new Error(`未対応のCEFRレベルです: ${level}（対応レベル: ${Object.keys(CEFR_TO_TOEIC_BAND).join(', ')}）`)
    }
  }

  const csvPath = args.csv ?? DEFAULT_CSV_PATH
  const csvText = readFileSync(csvPath, 'utf-8')
  const rows = parseCefrjCsv(csvText)
  const candidates = filterCefrjCandidates({ rows, levels })

  const supabase = createSupabaseAdminClient()
  const existingPairs = await loadExistingVocabWordPosPairs(supabase)
  const newCandidates = excludeExistingCandidates(candidates, existingPairs)

  console.log(
    `CEFR-J候補: レベル${levels.join('/')}で${candidates.length}語中、未収録${newCandidates.length}語（--limit ${limit}件のみ使用）`,
  )

  const selected = newCandidates.slice(0, limit)
  if (selected.length === 0) {
    console.log('対象となる新規単語がありません。処理を終了します。')
    return
  }

  if (args['dry-run']) {
    console.log('--dry-run のため、以下の候補語を表示するのみでGemini呼び出し・DB書き込みは行いません:')
    for (const c of selected) {
      console.log(`  - ${c.word} (${c.partOfSpeech}, CEFR ${c.cefrLevel})`)
    }
    return
  }

  // 複数レベルが混在する場合、目安バンドは選定語のうち最も高いレベルに合わせる
  // （既存パイプラインはバッチ全体に対して単一のtargetBandしか渡せない設計のため）。
  const targetBand = args['target-band']
    ? Number(args['target-band'])
    : Math.max(...selected.map((c) => CEFR_TO_TOEIC_BAND[c.cefrLevel]))

  const result = await generateVocabBatchFromWordlist(
    { words: selected, targetBand, modelName: args.model },
    { supabase, generateJsonArray },
  )

  console.log(`生成完了: batch_id=${result.batchId}, ${result.itemCount}件を generation_batch_items に保存しました。`)
  console.log(`次は検証を実行してください: npx tsx scripts/content-generation/validate_batch.ts --batch ${result.batchId}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
