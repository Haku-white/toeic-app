import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findWeakGrammarQuestions,
  findWeakVocabWords,
  DEFAULT_GRAMMAR_MIN_ATTEMPTS,
  DEFAULT_GRAMMAR_MAX_ACCURACY,
  DEFAULT_VOCAB_MIN_REVIEWS,
  DEFAULT_VOCAB_MIN_AGAIN_RATE,
  type WeakGrammarQuestion,
  type WeakVocabWord,
} from './weaknessDetection'
import { generateGrammarExplanations, generateVocabExplanations } from './generateExplanationEnhancement'
import { validateBatch } from './validateBatch'
import { commitBatch } from './commitBatch'
import { createThrottledPool, type ThrottledPool } from './concurrencyPool'
import {
  isRetryableError,
  type generateJson as generateJsonFn,
  type generateJsonArray as generateJsonArrayFn,
} from './gemini'
import { DEFAULT_BATCH_SIZE, DEFAULT_CONCURRENCY, DEFAULT_MAX_SHRINK_ATTEMPTS, DEFAULT_MIN_BATCH_SIZE, DEFAULT_THROTTLE_MS, type ShrinkRetryOutcome } from './autoBackfill'

/** 11.6: セルフチェックを行わない（11.3）ため1件あたりGemini呼び出し高々1回で済み、10章より高めの上限。 */
export const DEFAULT_MAX_TOTAL = 50

export interface EnhanceExplanationsDeps {
  supabase: SupabaseClient
  generateJsonArray: typeof generateJsonArrayFn
  generateJson: typeof generateJsonFn
  /** テスト・検証用にプールを差し替え可能にする。省略時は本番用のThrottledPoolを作る。 */
  pool?: ThrottledPool
}

export interface EnhanceExplanationsOptions {
  grammarMinAttempts?: number
  grammarMaxAccuracy?: number
  vocabMinReviews?: number
  vocabMinAgainRate?: number
  batchSize?: number
  minBatchSize?: number
  maxShrinkAttempts?: number
  concurrency?: number
  throttleMs?: number
  maxTotal?: number
  modelName?: string
  /** trueの場合、対象件数のみ返し生成は一切行わない */
  dryRun?: boolean
}

export interface EnhanceExplanationsTaskResult {
  kind: 'grammar' | 'vocab'
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

export interface EnhanceExplanationsResult {
  dryRun: boolean
  weakGrammar: WeakGrammarQuestion[]
  weakVocab: WeakVocabWord[]
  tasks: EnhanceExplanationsTaskResult[]
  totalEnhanced: number
  totalNeedsReview: number
  /** 11.6: 1回あたりの対象件数上限により今回処理しなかった件数（文法優先で予算を消費するため） */
  grammarSkippedCount: number
  vocabSkippedCount: number
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * 11.4: `autoBackfill.ts`の`generateWithShrinkRetry`（10.7）と同じ判定ロジック・縮小幅を使うが、
 * こちらは「件数」ではなく「対象アイテムの配列」を半分に割って縮小する変種。追加解説の対象は
 * 既存の特定の行のため、抽象的な件数の代わりを新規生成できず、配列を分割する必要があるため。
 */
async function generateExplanationsWithShrinkRetry<T>(
  items: T[],
  minBatchSize: number,
  maxShrinkAttempts: number,
  generateOne: (subset: T[]) => Promise<{ batchId: string; itemCount: number }>,
  shrinkAttempt = 0,
): Promise<ShrinkRetryOutcome> {
  if (items.length === 0) return { batchIds: [], generatedCount: 0, gaveUpCount: 0 }

  try {
    const result = await generateOne(items)
    return { batchIds: [result.batchId], generatedCount: result.itemCount, gaveUpCount: 0 }
  } catch (error) {
    if (!isRetryableError(error)) throw error

    if (items.length <= minBatchSize || shrinkAttempt >= maxShrinkAttempts) {
      const message = error instanceof Error ? error.message : JSON.stringify(error)
      console.error(
        `バッチサイズを${items.length}まで縮小しても生成に失敗したため、この分(${items.length}件)は今回諦めます: ${message}`,
      )
      return { batchIds: [], generatedCount: 0, gaveUpCount: items.length }
    }

    const half = Math.max(minBatchSize, Math.ceil(items.length / 2))
    const firstItems = items.slice(0, half)
    const restItems = items.slice(half)
    console.warn(`生成が失敗したためバッチサイズを${items.length}件→${half}件(+残り${restItems.length}件)に縮小して再試行します。`)

    const first = await generateExplanationsWithShrinkRetry(
      firstItems,
      minBatchSize,
      maxShrinkAttempts,
      generateOne,
      shrinkAttempt + 1,
    )
    const second =
      restItems.length > 0
        ? await generateExplanationsWithShrinkRetry(restItems, minBatchSize, maxShrinkAttempts, generateOne, shrinkAttempt + 1)
        : { batchIds: [], generatedCount: 0, gaveUpCount: 0 }

    return {
      batchIds: [...first.batchIds, ...second.batchIds],
      generatedCount: first.generatedCount + second.generatedCount,
      gaveUpCount: first.gaveUpCount + second.gaveUpCount,
    }
  }
}

type EnhancementChunk = { kind: 'grammar'; items: WeakGrammarQuestion[] } | { kind: 'vocab'; items: WeakVocabWord[] }

async function finalizeOutcome(
  kind: 'grammar' | 'vocab',
  requestedCount: number,
  outcome: ShrinkRetryOutcome,
  deps: Pick<EnhanceExplanationsDeps, 'supabase' | 'generateJson'>,
): Promise<EnhanceExplanationsTaskResult> {
  let autoPassed = 0
  let needsReview = 0
  let committedCount = 0
  let failedCount = 0

  for (const batchId of outcome.batchIds) {
    const validated = await validateBatch(batchId, { supabase: deps.supabase, generateJson: deps.generateJson })
    const committed = await commitBatch(batchId, { supabase: deps.supabase })
    autoPassed += validated.autoPassed
    needsReview += validated.needsReview
    committedCount += committed.committedCount
    failedCount += committed.failedCount
  }

  return {
    kind,
    requestedCount,
    generatedCount: outcome.generatedCount,
    autoPassed,
    needsReview,
    committedCount,
    failedCount,
    gaveUpCount: outcome.gaveUpCount,
    batchIds: outcome.batchIds,
  }
}

async function processChunk(
  chunk: EnhancementChunk,
  deps: EnhanceExplanationsDeps,
  options: { minBatchSize: number; maxShrinkAttempts: number; modelName?: string },
): Promise<EnhanceExplanationsTaskResult> {
  if (chunk.kind === 'grammar') {
    const outcome = await generateExplanationsWithShrinkRetry(
      chunk.items,
      options.minBatchSize,
      options.maxShrinkAttempts,
      (subset) =>
        generateGrammarExplanations(
          { items: subset, modelName: options.modelName },
          { supabase: deps.supabase, generateJsonArray: deps.generateJsonArray },
        ),
    )
    return finalizeOutcome('grammar', chunk.items.length, outcome, deps)
  }

  const outcome = await generateExplanationsWithShrinkRetry(
    chunk.items,
    options.minBatchSize,
    options.maxShrinkAttempts,
    (subset) =>
      generateVocabExplanations(
        { items: subset, modelName: options.modelName },
        { supabase: deps.supabase, generateJsonArray: deps.generateJsonArray },
      ),
  )
  return finalizeOutcome('vocab', chunk.items.length, outcome, deps)
}

/**
 * 11章: 正答率/記憶定着率が低い問題・単語（`weaknessDetection.ts`）を検出し、
 * 既存の解説を上書きせず追加解説（`additional_explanation`）を生成→検証→
 * (auto_passedのみ)コミットする。10章の同時実行数制限・スロットリング（`concurrencyPool.ts`）
 * をそのまま再利用する。
 */
export async function runExplanationEnhancement(
  deps: EnhanceExplanationsDeps,
  options: EnhanceExplanationsOptions = {},
): Promise<EnhanceExplanationsResult> {
  const grammarMinAttempts = options.grammarMinAttempts ?? DEFAULT_GRAMMAR_MIN_ATTEMPTS
  const grammarMaxAccuracy = options.grammarMaxAccuracy ?? DEFAULT_GRAMMAR_MAX_ACCURACY
  const vocabMinReviews = options.vocabMinReviews ?? DEFAULT_VOCAB_MIN_REVIEWS
  const vocabMinAgainRate = options.vocabMinAgainRate ?? DEFAULT_VOCAB_MIN_AGAIN_RATE
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const minBatchSize = options.minBatchSize ?? DEFAULT_MIN_BATCH_SIZE
  const maxShrinkAttempts = options.maxShrinkAttempts ?? DEFAULT_MAX_SHRINK_ATTEMPTS
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS
  const maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL

  const weakGrammar = await findWeakGrammarQuestions(deps.supabase, grammarMinAttempts, grammarMaxAccuracy)
  const weakVocab = await findWeakVocabWords(deps.supabase, vocabMinReviews, vocabMinAgainRate)

  if (options.dryRun) {
    return {
      dryRun: true,
      weakGrammar,
      weakVocab,
      tasks: [],
      totalEnhanced: 0,
      totalNeedsReview: 0,
      grammarSkippedCount: 0,
      vocabSkippedCount: 0,
    }
  }

  // 11.6: 1回あたりの対象件数上限を適用する。文法優先で予算を消費し、残りを語彙に回す
  // （どちらも同じ弱点対策のため優先順位に強い根拠は無く、実装のシンプルさを優先した判断）。
  const cappedGrammar = weakGrammar.slice(0, maxTotal)
  const remainingBudget = Math.max(0, maxTotal - cappedGrammar.length)
  const cappedVocab = weakVocab.slice(0, remainingBudget)
  const grammarSkippedCount = weakGrammar.length - cappedGrammar.length
  const vocabSkippedCount = weakVocab.length - cappedVocab.length

  const chunks: EnhancementChunk[] = [
    ...chunkArray(cappedGrammar, batchSize).map((items) => ({ kind: 'grammar' as const, items })),
    ...chunkArray(cappedVocab, batchSize).map((items) => ({ kind: 'vocab' as const, items })),
  ]

  const pool = deps.pool ?? createThrottledPool({ concurrency, minIntervalMs: throttleMs })

  const tasks = await Promise.all(
    chunks.map((chunk) => pool.run(() => processChunk(chunk, deps, { minBatchSize, maxShrinkAttempts, modelName: options.modelName }))),
  )

  const totalEnhanced = tasks.reduce((sum, t) => sum + t.committedCount, 0)
  const totalNeedsReview = tasks.reduce((sum, t) => sum + t.needsReview, 0)

  return {
    dryRun: false,
    weakGrammar,
    weakVocab,
    tasks,
    totalEnhanced,
    totalNeedsReview,
    grammarSkippedCount,
    vocabSkippedCount,
  }
}
