import type { SupabaseClient } from '@supabase/supabase-js'

export type ReviewDecision = 'approved' | 'rejected'

export interface ApplyReviewDecisionParams {
  decision: ReviewDecision
  reviewerId?: string | null
  notes?: string | null
}

export interface NeedsReviewItem {
  id: string
  raw_payload: unknown
  validation_errors: unknown
  self_check_payload: unknown
}

/** 8.5: `needs_review`のアイテムを一覧取得する（`raw_payload`/`validation_errors`/`self_check_payload`を並べて表示するため） */
export async function fetchNeedsReviewItems(supabase: SupabaseClient, batchId: string): Promise<NeedsReviewItem[]> {
  const { data, error } = await supabase
    .from('generation_batch_items')
    .select('id, raw_payload, validation_errors, self_check_payload')
    .eq('batch_id', batchId)
    .eq('status', 'needs_review')
  if (error) throw error
  return (data ?? []) as NeedsReviewItem[]
}

/** レビュー結果をitem行に反映するためのフィールドを組み立てる（副作用なし、単体テストしやすくするため分離） */
export function buildReviewUpdateFields(params: ApplyReviewDecisionParams): Record<string, unknown> {
  return {
    status: params.decision,
    reviewed_by: params.reviewerId ?? null,
    reviewed_at: new Date().toISOString(),
    review_notes: params.notes ?? null,
  }
}

/** 8.5: `approved`/`rejected`のいずれかで`generation_batch_items`を更新する */
export async function applyReviewDecision(
  supabase: SupabaseClient,
  itemId: string,
  params: ApplyReviewDecisionParams,
): Promise<void> {
  const { error } = await supabase
    .from('generation_batch_items')
    .update(buildReviewUpdateFields(params))
    .eq('id', itemId)
  if (error) throw error
}
