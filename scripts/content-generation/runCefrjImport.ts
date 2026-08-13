import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CEFR_TO_TOEIC_BAND,
  excludeExistingCandidates,
  filterCefrjCandidates,
  parseCefrjCsv,
  sampleEvenly,
  type CefrjCandidate,
} from './cefrjWordlist'
import { loadExistingVocabWordPosPairs, validateBatch } from './validateBatch'
import { commitBatch } from './commitBatch'
import { generateVocabBatchFromWordlist } from './generateVocab'
import { createThrottledPool, type ThrottledPool } from './concurrencyPool'
import {
  isRetryableError,
  type generateJson as generateJsonFn,
  type generateJsonArray as generateJsonArrayFn,
} from './gemini'
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_SHRINK_ATTEMPTS,
  DEFAULT_MIN_BATCH_SIZE,
  DEFAULT_THROTTLE_MS,
  type ShrinkRetryOutcome,
} from './autoBackfill'

/** 21.9: 10.5・11.4と同じサブバッチサイズをそのまま踏襲する。 */
export const DEFAULT_BATCH_SIZE = 8
/** 21.9: ユーザー推奨「まずは数百語程度」を踏まえた既定値。根拠はDESIGN.md 21.9参照。 */
export const DEFAULT_MAX_TOTAL = 300
/** 21.2: 既存収録語彙のCEFR一致分の81%がB1〜B2に集中しており、TOEIC対策として最も妥当な帯。 */
export const DEFAULT_LEVELS = ['B1', 'B2']

const currentDir = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CSV_PATH = join(currentDir, 'data', 'cefrj-vocabulary-profile-1.5.csv')

export interface RunCefrjImportDeps {
  supabase: SupabaseClient
  generateJsonArray: typeof generateJsonArrayFn
  generateJson: typeof generateJsonFn
  /** テスト・検証用にプールを差し替え可能にする。省略時は本番用のThrottledPoolを作る。 */
  pool?: ThrottledPool
}

export interface RunCefrjImportOptions {
  levels?: string[]
  /** テスト用にCSVの中身を直接注入できる。省略時は同梱のCSVファイルを読む。 */
  csvText?: string
  maxTotal?: number
  batchSize?: number
  minBatchSize?: number
  maxShrinkAttempts?: number
  concurrency?: number
  throttleMs?: number
  modelName?: string
  /** trueの場合、候補抽出・選定結果のみ返し生成は一切行わない */
  dryRun?: boolean
}

export interface RunCefrjImportChunkResult {
  requestedCount: number
  generatedCount: number
  autoPassed: number
  needsReview: number
  committedCount: number
  failedCount: number
  /** 10.7と同じ意味: バッチサイズ縮小を使い切っても生成できず、今回諦めた件数 */
  gaveUpCount: number
  batchIds: string[]
}

export interface RunCefrjImportResult {
  dryRun: boolean
  /** 重複除外後、選定前の候補語総数 */
  totalCandidates: number
  /** sampleEvenly適用後、実際に処理した語数 */
  selectedCount: number
  chunks: RunCefrjImportChunkResult[]
  totalGenerated: number
  totalCommitted: number
  totalNeedsReview: number
  totalGaveUp: number
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function chunkTargetBand(words: CefrjCandidate[]): number {
  return Math.max(...words.map((w) => CEFR_TO_TOEIC_BAND[w.cefrLevel] ?? 0))
}

/**
 * 21.9: `enhanceExplanations.ts`の`generateExplanationsWithShrinkRetry`（11.4）と同じ判定
 * ロジック・縮小幅（`autoBackfill.ts`の`generateWithShrinkRetry`、10.7）を、CEFR-J候補語の
 * 配列向けに再利用する。「件数」ではなく「単語配列」を半分に割って縮小する点が10.7の
 * count版と異なる（11.4が既に直面した同じ問題への同じ解決策）。
 */
async function generateCefrjChunkWithShrinkRetry(
  words: CefrjCandidate[],
  minBatchSize: number,
  maxShrinkAttempts: number,
  generateOne: (subset: CefrjCandidate[]) => Promise<{ batchId: string; itemCount: number }>,
  shrinkAttempt = 0,
): Promise<ShrinkRetryOutcome> {
  if (words.length === 0) return { batchIds: [], generatedCount: 0, gaveUpCount: 0 }

  try {
    const result = await generateOne(words)
    return { batchIds: [result.batchId], generatedCount: result.itemCount, gaveUpCount: 0 }
  } catch (error) {
    if (!isRetryableError(error)) throw error

    if (words.length <= minBatchSize || shrinkAttempt >= maxShrinkAttempts) {
      const message = error instanceof Error ? error.message : JSON.stringify(error)
      console.error(
        `バッチサイズを${words.length}まで縮小しても生成に失敗したため、この分(${words.length}件)は今回諦めます: ${message}`,
      )
      return { batchIds: [], generatedCount: 0, gaveUpCount: words.length }
    }

    const half = Math.max(minBatchSize, Math.ceil(words.length / 2))
    const firstWords = words.slice(0, half)
    const restWords = words.slice(half)
    console.warn(
      `生成が失敗したためバッチサイズを${words.length}件→${half}件(+残り${restWords.length}件)に縮小して再試行します。`,
    )

    const first = await generateCefrjChunkWithShrinkRetry(
      firstWords,
      minBatchSize,
      maxShrinkAttempts,
      generateOne,
      shrinkAttempt + 1,
    )
    const second =
      restWords.length > 0
        ? await generateCefrjChunkWithShrinkRetry(restWords, minBatchSize, maxShrinkAttempts, generateOne, shrinkAttempt + 1)
        : { batchIds: [], generatedCount: 0, gaveUpCount: 0 }

    return {
      batchIds: [...first.batchIds, ...second.batchIds],
      generatedCount: first.generatedCount + second.generatedCount,
      gaveUpCount: first.gaveUpCount + second.gaveUpCount,
    }
  }
}

async function processChunk(
  words: CefrjCandidate[],
  deps: RunCefrjImportDeps,
  options: { minBatchSize: number; maxShrinkAttempts: number; modelName?: string },
): Promise<RunCefrjImportChunkResult> {
  const targetBand = chunkTargetBand(words)

  const outcome = await generateCefrjChunkWithShrinkRetry(
    words,
    options.minBatchSize,
    options.maxShrinkAttempts,
    (subset) =>
      generateVocabBatchFromWordlist(
        { words: subset, targetBand, modelName: options.modelName },
        { supabase: deps.supabase, generateJsonArray: deps.generateJsonArray },
      ),
  )

  let autoPassed = 0
  let needsReview = 0
  let committedCount = 0
  let failedCount = 0

  // 10.4と同じ方針: needs_reviewが出てもそのサブバッチのauto_passed分は普通にコミットし、
  // 他のサブバッチの処理は止めない。
  for (const batchId of outcome.batchIds) {
    const validated = await validateBatch(batchId, { supabase: deps.supabase, generateJson: deps.generateJson })
    const committed = await commitBatch(batchId, { supabase: deps.supabase })
    autoPassed += validated.autoPassed
    needsReview += validated.needsReview
    committedCount += committed.committedCount
    failedCount += committed.failedCount
  }

  return {
    requestedCount: words.length,
    generatedCount: outcome.generatedCount,
    autoPassed,
    needsReview,
    committedCount,
    failedCount,
    gaveUpCount: outcome.gaveUpCount,
    batchIds: outcome.batchIds,
  }
}

/**
 * 21.9: CEFR-J Wordlistから、既存パイプラインの1回限りバックフィル（21.6・25語）を
 * 実運用規模に拡大したもの。抽出→重複除外→`sampleEvenly`での均等選定→サブバッチ分割→
 * `concurrencyPool`での並列生成→検証→(auto_passedのみ)コミット、まで自動実行する。
 * 10章の同時実行数制限・スロットリング・段階的バッチサイズ縮小をそのまま再利用する。
 */
export async function runCefrjImport(
  deps: RunCefrjImportDeps,
  options: RunCefrjImportOptions = {},
): Promise<RunCefrjImportResult> {
  const levels = options.levels ?? DEFAULT_LEVELS
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const minBatchSize = options.minBatchSize ?? DEFAULT_MIN_BATCH_SIZE
  const maxShrinkAttempts = options.maxShrinkAttempts ?? DEFAULT_MAX_SHRINK_ATTEMPTS
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS

  const csvText = options.csvText ?? readFileSync(DEFAULT_CSV_PATH, 'utf-8')
  const rows = parseCefrjCsv(csvText)
  const candidates = filterCefrjCandidates({ rows, levels })

  const existingPairs = await loadExistingVocabWordPosPairs(deps.supabase)
  const newCandidates = excludeExistingCandidates(candidates, existingPairs)
  const selected = sampleEvenly(newCandidates, maxTotal)

  if (options.dryRun) {
    return {
      dryRun: true,
      totalCandidates: newCandidates.length,
      selectedCount: selected.length,
      chunks: [],
      totalGenerated: 0,
      totalCommitted: 0,
      totalNeedsReview: 0,
      totalGaveUp: 0,
    }
  }

  const wordChunks = chunkArray(selected, batchSize)
  const pool = deps.pool ?? createThrottledPool({ concurrency, minIntervalMs: throttleMs })

  const chunks = await Promise.all(
    wordChunks.map((words) =>
      pool.run(() => processChunk(words, deps, { minBatchSize, maxShrinkAttempts, modelName: options.modelName })),
    ),
  )

  return {
    dryRun: false,
    totalCandidates: newCandidates.length,
    selectedCount: selected.length,
    chunks,
    totalGenerated: chunks.reduce((sum, c) => sum + c.generatedCount, 0),
    totalCommitted: chunks.reduce((sum, c) => sum + c.committedCount, 0),
    totalNeedsReview: chunks.reduce((sum, c) => sum + c.needsReview, 0),
    totalGaveUp: chunks.reduce((sum, c) => sum + c.gaveUpCount, 0),
  }
}
