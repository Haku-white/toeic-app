import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkGrammarInventory,
  checkVocabInventory,
  DEFAULT_GRAMMAR_THRESHOLD,
  DEFAULT_GRAMMAR_TARGET,
  DEFAULT_VOCAB_THRESHOLD,
  DEFAULT_VOCAB_TARGET,
  type GrammarCategoryInventory,
  type VocabTagInventory,
} from './inventoryCheck'
import { generateGrammarBatch } from './generateGrammar'
import { generateVocabBatch, IDIOM_TAG_NAME } from './generateVocab'
import { validateBatch } from './validateBatch'
import { commitBatch } from './commitBatch'
import { createThrottledPool, type ThrottledPool } from './concurrencyPool'
import { isRetryableError, type generateJson as generateJsonFn, type generateJsonArray as generateJsonArrayFn } from './gemini'

export const DEFAULT_BATCH_SIZE = 8
export const DEFAULT_MIN_BATCH_SIZE = 2
export const DEFAULT_MAX_SHRINK_ATTEMPTS = 3
export const DEFAULT_CONCURRENCY = 2
export const DEFAULT_THROTTLE_MS = 1500
export const DEFAULT_MAX_TOTAL = 100
export const DEFAULT_TARGET_BAND = 730

/** 10.4: 文法の不足数を難易度3:4:5に按分する既存の15:15:10比率（≒3:3:2）を踏襲する */
const GRAMMAR_DIFFICULTY_WEIGHTS: Array<{ difficulty: number; weight: number }> = [
  { difficulty: 3, weight: 3 },
  { difficulty: 4, weight: 3 },
  { difficulty: 5, weight: 2 },
]

export interface AutoBackfillDeps {
  supabase: SupabaseClient
  generateJsonArray: typeof generateJsonArrayFn
  generateJson: typeof generateJsonFn
  /** テスト・検証用にプールを差し替え可能にする。省略時は本番用のThrottledPoolを作る。 */
  pool?: ThrottledPool
}

export interface AutoBackfillOptions {
  grammarThreshold?: number
  grammarTarget?: number
  vocabThreshold?: number
  vocabTarget?: number
  batchSize?: number
  minBatchSize?: number
  maxShrinkAttempts?: number
  concurrency?: number
  throttleMs?: number
  maxTotal?: number
  targetBand?: number
  modelName?: string
  /** trueの場合、在庫チェックの結果のみ返し生成は一切行わない */
  dryRun?: boolean
}

export interface AutoBackfillTaskResult {
  kind: 'grammar' | 'vocab'
  label: string
  requestedCount: number
  generatedCount: number
  autoPassed: number
  needsReview: number
  committedCount: number
  failedCount: number
  /** 10.7: バッチサイズ縮小を使い切っても生成できず、今回諦めた件数 */
  gaveUpCount: number
  batchIds: string[]
}

export interface AutoBackfillResult {
  dryRun: boolean
  grammarInventory: GrammarCategoryInventory[]
  vocabInventory: VocabTagInventory[]
  tasks: AutoBackfillTaskResult[]
  totalGenerated: number
  totalCommitted: number
  totalNeedsReview: number
  /** 10.12: 1回あたりの生成上限に達したため今回処理できなかったカテゴリ/タグ */
  skippedDueToMaxTotal: Array<{ kind: 'grammar' | 'vocab'; label: string; shortfall: number }>
}

/**
 * 10.4: 不足数を既存の15:15:10（≒3:3:2）比率で難易度3/4/5に按分する。
 * 端数は小数部が大きい順に1件ずつ配る。
 */
export function distributeGrammarShortfall(shortfall: number): Array<{ difficulty: number; count: number }> {
  if (shortfall <= 0) return []
  const totalWeight = GRAMMAR_DIFFICULTY_WEIGHTS.reduce((sum, w) => sum + w.weight, 0)
  const raw = GRAMMAR_DIFFICULTY_WEIGHTS.map((w) => (shortfall * w.weight) / totalWeight)
  const floors = raw.map(Math.floor)
  const remainder = shortfall - floors.reduce((a, b) => a + b, 0)

  const order = raw.map((v, i) => ({ i, frac: v - floors[i] })).sort((a, b) => b.frac - a.frac)
  const counts = [...floors]
  for (let k = 0; k < remainder && order.length > 0; k += 1) {
    counts[order[k % order.length].i] += 1
  }

  return GRAMMAR_DIFFICULTY_WEIGHTS.map((w, i) => ({ difficulty: w.difficulty, count: counts[i] })).filter(
    (c) => c.count > 0,
  )
}

/** 10.5: 合計件数を`chunkSize`以下のサブバッチに分割する */
export function chunkCount(total: number, chunkSize: number): number[] {
  const chunks: number[] = []
  let remaining = total
  while (remaining > 0) {
    const size = Math.min(chunkSize, remaining)
    chunks.push(size)
    remaining -= size
  }
  return chunks
}

interface GrammarSubBatchDescriptor {
  kind: 'grammar'
  categoryCode: string
  difficulty: number
  count: number
}

interface VocabSubBatchDescriptor {
  kind: 'vocab'
  tagName: string
  contentKind: 'vocab' | 'idiom'
  count: number
}

type SubBatchDescriptor = GrammarSubBatchDescriptor | VocabSubBatchDescriptor

function descriptorLabel(descriptor: SubBatchDescriptor): string {
  return descriptor.kind === 'grammar' ? descriptor.categoryCode : descriptor.tagName
}

function buildDescriptors(
  grammarInventory: GrammarCategoryInventory[],
  vocabInventory: VocabTagInventory[],
  batchSize: number,
): SubBatchDescriptor[] {
  const descriptors: SubBatchDescriptor[] = []

  for (const category of grammarInventory) {
    for (const tier of distributeGrammarShortfall(category.shortfall)) {
      for (const count of chunkCount(tier.count, batchSize)) {
        descriptors.push({ kind: 'grammar', categoryCode: category.categoryCode, difficulty: tier.difficulty, count })
      }
    }
  }

  for (const tag of vocabInventory) {
    const contentKind = tag.tagName === IDIOM_TAG_NAME ? 'idiom' : 'vocab'
    for (const count of chunkCount(tag.shortfall, batchSize)) {
      descriptors.push({ kind: 'vocab', tagName: tag.tagName, contentKind, count })
    }
  }

  return descriptors
}

/**
 * 10.12: 総生成件数の上限を適用する。上限に達した時点の記述子は途中まで（残り枠分だけ）に
 * 縮めて処理対象に残し、それ以降・および縮められた記述子のラベルは`skippedLabels`に記録する
 * （次回実行時に閾値未満のままなので自動的に再検出される）。
 */
function applyMaxTotalCap(
  descriptors: SubBatchDescriptor[],
  maxTotal: number,
): { descriptors: SubBatchDescriptor[]; skippedLabels: Set<string> } {
  const result: SubBatchDescriptor[] = []
  const skippedLabels = new Set<string>()
  let remaining = maxTotal

  for (const descriptor of descriptors) {
    if (remaining <= 0) {
      skippedLabels.add(descriptorLabel(descriptor))
      continue
    }
    if (descriptor.count <= remaining) {
      result.push(descriptor)
      remaining -= descriptor.count
    } else {
      result.push({ ...descriptor, count: remaining } as SubBatchDescriptor)
      skippedLabels.add(descriptorLabel(descriptor))
      remaining = 0
    }
  }

  return { descriptors: result, skippedLabels }
}

export interface ShrinkRetryOutcome {
  batchIds: string[]
  generatedCount: number
  gaveUpCount: number
}

/**
 * 10.7: 段階的なバッチサイズ縮小。gemini.ts内の5回リトライを使い切った末の429/5xx系エラー
 * （`isRetryableError`）のときのみ縮小して再試行する。それ以外の致命的エラーは即座に上位へ
 * 伝播させる（既存の一回限りバックフィルスクリプトの「予期しないエラーは中断」方針を踏襲）。
 * `enhanceExplanations.ts`（11.4）が同じ判定ロジック・縮小幅を再利用するためexportしている
 * （対象アイテムの配列を縮小する`generateExplanationsWithShrinkRetry`は件数ではなく配列を
 * 扱う点が異なるため、このまま流用はせず並行する形の別関数として実装しているが、
 * `isRetryableError`の判定・縮小段階の考え方は共通）。
 */
export async function generateWithShrinkRetry(
  requestCount: number,
  minBatchSize: number,
  maxShrinkAttempts: number,
  generateOne: (count: number) => Promise<{ batchId: string; itemCount: number }>,
  shrinkAttempt = 0,
): Promise<ShrinkRetryOutcome> {
  if (requestCount <= 0) return { batchIds: [], generatedCount: 0, gaveUpCount: 0 }

  try {
    const result = await generateOne(requestCount)
    return { batchIds: [result.batchId], generatedCount: result.itemCount, gaveUpCount: 0 }
  } catch (error) {
    if (!isRetryableError(error)) throw error

    if (requestCount <= minBatchSize || shrinkAttempt >= maxShrinkAttempts) {
      const message = error instanceof Error ? error.message : JSON.stringify(error)
      console.error(
        `バッチサイズを${requestCount}まで縮小しても生成に失敗したため、この分(${requestCount}件)は今回諦めます: ${message}`,
      )
      return { batchIds: [], generatedCount: 0, gaveUpCount: requestCount }
    }

    const half = Math.max(minBatchSize, Math.ceil(requestCount / 2))
    const rest = requestCount - half
    console.warn(`生成が失敗したためバッチサイズを${requestCount}件→${half}件(+残り${rest}件)に縮小して再試行します。`)

    const first = await generateWithShrinkRetry(half, minBatchSize, maxShrinkAttempts, generateOne, shrinkAttempt + 1)
    const second =
      rest > 0
        ? await generateWithShrinkRetry(rest, minBatchSize, maxShrinkAttempts, generateOne, shrinkAttempt + 1)
        : { batchIds: [], generatedCount: 0, gaveUpCount: 0 }

    return {
      batchIds: [...first.batchIds, ...second.batchIds],
      generatedCount: first.generatedCount + second.generatedCount,
      gaveUpCount: first.gaveUpCount + second.gaveUpCount,
    }
  }
}

interface ProcessDescriptorOptions {
  targetBand: number
  modelName?: string
  minBatchSize: number
  maxShrinkAttempts: number
}

async function processDescriptor(
  descriptor: SubBatchDescriptor,
  deps: Pick<AutoBackfillDeps, 'supabase' | 'generateJsonArray' | 'generateJson'>,
  options: ProcessDescriptorOptions,
): Promise<AutoBackfillTaskResult> {
  const generateOne =
    descriptor.kind === 'grammar'
      ? (count: number) =>
          generateGrammarBatch(
            {
              categoryCode: descriptor.categoryCode,
              count,
              difficulty: descriptor.difficulty,
              targetBand: options.targetBand,
              modelName: options.modelName,
            },
            { supabase: deps.supabase, generateJsonArray: deps.generateJsonArray },
          )
      : (count: number) =>
          generateVocabBatch(
            {
              tagName: descriptor.contentKind === 'idiom' ? undefined : descriptor.tagName,
              contentKind: descriptor.contentKind,
              count,
              targetBand: options.targetBand,
              modelName: options.modelName,
            },
            { supabase: deps.supabase, generateJsonArray: deps.generateJsonArray },
          )

  const outcome = await generateWithShrinkRetry(
    descriptor.count,
    options.minBatchSize,
    options.maxShrinkAttempts,
    generateOne,
  )

  let autoPassed = 0
  let needsReview = 0
  let committedCount = 0
  let failedCount = 0

  // 10.4: needs_reviewが出てもそのバッチのauto_passed分は普通にコミットし、他のサブバッチ・
  // カテゴリ/タグの処理は止めない（既存の一回限りバックフィルスクリプトの「1件でも
  // needs_reviewが出たら中断」という方針から意図的に外れる、10.4参照）。
  for (const batchId of outcome.batchIds) {
    const validated = await validateBatch(batchId, { supabase: deps.supabase, generateJson: deps.generateJson })
    const committed = await commitBatch(batchId, { supabase: deps.supabase })
    autoPassed += validated.autoPassed
    needsReview += validated.needsReview
    committedCount += committed.committedCount
    failedCount += committed.failedCount
  }

  return {
    kind: descriptor.kind,
    label: descriptorLabel(descriptor),
    requestedCount: descriptor.count,
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
 * 10章: 在庫チェック（`inventoryCheck.ts`）の結果をもとに、閾値未満のカテゴリ/タグそれぞれの
 * 不足数を埋める生成タスクを組み立て、同時実行数制限・スロットリング（`concurrencyPool.ts`）を
 * 通して「生成→検証→(auto_passedのみ)コミット」まで自動実行する。
 */
export async function runAutoBackfill(
  deps: AutoBackfillDeps,
  options: AutoBackfillOptions = {},
): Promise<AutoBackfillResult> {
  const grammarThreshold = options.grammarThreshold ?? DEFAULT_GRAMMAR_THRESHOLD
  const grammarTarget = options.grammarTarget ?? DEFAULT_GRAMMAR_TARGET
  const vocabThreshold = options.vocabThreshold ?? DEFAULT_VOCAB_THRESHOLD
  const vocabTarget = options.vocabTarget ?? DEFAULT_VOCAB_TARGET
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const minBatchSize = options.minBatchSize ?? DEFAULT_MIN_BATCH_SIZE
  const maxShrinkAttempts = options.maxShrinkAttempts ?? DEFAULT_MAX_SHRINK_ATTEMPTS
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL
  const targetBand = options.targetBand ?? DEFAULT_TARGET_BAND

  const grammarInventory = await checkGrammarInventory(deps.supabase, grammarThreshold, grammarTarget)
  const vocabInventory = await checkVocabInventory(deps.supabase, vocabThreshold, vocabTarget)

  if (options.dryRun) {
    return {
      dryRun: true,
      grammarInventory,
      vocabInventory,
      tasks: [],
      totalGenerated: 0,
      totalCommitted: 0,
      totalNeedsReview: 0,
      skippedDueToMaxTotal: [],
    }
  }

  const allDescriptors = buildDescriptors(grammarInventory, vocabInventory, batchSize)
  const { descriptors, skippedLabels } = applyMaxTotalCap(allDescriptors, maxTotal)

  const pool = deps.pool ?? createThrottledPool({ concurrency, minIntervalMs: throttleMs })

  const tasks = await Promise.all(
    descriptors.map((descriptor) =>
      pool.run(() =>
        processDescriptor(descriptor, deps, { targetBand, modelName: options.modelName, minBatchSize, maxShrinkAttempts }),
      ),
    ),
  )

  const totalGenerated = tasks.reduce((sum, t) => sum + t.generatedCount, 0)
  const totalCommitted = tasks.reduce((sum, t) => sum + t.committedCount, 0)
  const totalNeedsReview = tasks.reduce((sum, t) => sum + t.needsReview, 0)

  const skippedDueToMaxTotal: AutoBackfillResult['skippedDueToMaxTotal'] = [
    ...grammarInventory
      .filter((c) => skippedLabels.has(c.categoryCode))
      .map((c) => ({ kind: 'grammar' as const, label: c.categoryCode, shortfall: c.shortfall })),
    ...vocabInventory
      .filter((t) => skippedLabels.has(t.tagName))
      .map((t) => ({ kind: 'vocab' as const, label: t.tagName, shortfall: t.shortfall })),
  ]

  return {
    dryRun: false,
    grammarInventory,
    vocabInventory,
    tasks,
    totalGenerated,
    totalCommitted,
    totalNeedsReview,
    skippedDueToMaxTotal,
  }
}
