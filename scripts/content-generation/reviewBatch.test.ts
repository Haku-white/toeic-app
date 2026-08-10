import { describe, expect, it, vi } from 'vitest'
import { applyReviewDecision, buildReviewUpdateFields, fetchNeedsReviewItems } from './reviewBatch'

describe('buildReviewUpdateFields', () => {
  it('builds fields for an approval with a reviewer and notes', () => {
    const fields = buildReviewUpdateFields({ decision: 'approved', reviewerId: 'user-1', notes: 'looks good' })
    expect(fields.status).toBe('approved')
    expect(fields.reviewed_by).toBe('user-1')
    expect(fields.review_notes).toBe('looks good')
    expect(typeof fields.reviewed_at).toBe('string')
  })

  it('defaults reviewer and notes to null when omitted', () => {
    const fields = buildReviewUpdateFields({ decision: 'rejected' })
    expect(fields.reviewed_by).toBeNull()
    expect(fields.review_notes).toBeNull()
    expect(fields.status).toBe('rejected')
  })
})

describe('fetchNeedsReviewItems', () => {
  it('queries generation_batch_items filtered by batch_id and status=needs_review', async () => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.select = vi.fn(chain)
    builder.eq = vi.fn(chain)
    builder.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: 'item-1', raw_payload: {}, validation_errors: null, self_check_payload: null }], error: null }).then(
        onFulfilled,
      )

    const from = vi.fn(() => builder)
    const supabase = { from } as unknown as Parameters<typeof fetchNeedsReviewItems>[0]

    const items = await fetchNeedsReviewItems(supabase, 'batch-1')

    expect(from).toHaveBeenCalledWith('generation_batch_items')
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'batch_id', 'batch-1')
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'status', 'needs_review')
    expect(items).toHaveLength(1)
  })

  it('throws when the query returns an error', async () => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.select = vi.fn(chain)
    builder.eq = vi.fn(chain)
    builder.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: new Error('boom') }).then(onFulfilled)
    const supabase = { from: vi.fn(() => builder) } as unknown as Parameters<typeof fetchNeedsReviewItems>[0]

    await expect(fetchNeedsReviewItems(supabase, 'batch-1')).rejects.toThrow('boom')
  })
})

describe('applyReviewDecision', () => {
  it('updates the item with the built fields', async () => {
    const eqMock = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const updateMock = vi.fn(() => ({ eq: eqMock }))
    const supabase = { from: vi.fn(() => ({ update: updateMock })) } as unknown as Parameters<
      typeof applyReviewDecision
    >[0]

    await applyReviewDecision(supabase, 'item-1', { decision: 'approved', reviewerId: 'user-1' })

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', reviewed_by: 'user-1' }),
    )
    expect(eqMock).toHaveBeenCalledWith('id', 'item-1')
  })

  it('throws when the update fails', async () => {
    const eqMock = vi.fn(() => Promise.resolve({ data: null, error: new Error('denied') }))
    const supabase = {
      from: vi.fn(() => ({ update: vi.fn(() => ({ eq: eqMock })) })),
    } as unknown as Parameters<typeof applyReviewDecision>[0]

    await expect(applyReviewDecision(supabase, 'item-1', { decision: 'rejected' })).rejects.toThrow('denied')
  })
})
