import {
  addToDraft,
  draftProblem,
  findLineByCode,
  lineState,
  outstanding,
  setDraftQuantity,
  toDispatchLines,
  totalOutstanding,
  totalSent,
  type DraftLine,
  type TransferLineLike,
} from './transfer'

const line = (over: Partial<TransferLineLike> = {}): TransferLineLike => ({
  id: 'l1',
  product_name: 'Rice',
  sku: 'R-5',
  barcode: '8901234567890',
  qr_code: null,
  quantity_sent: 8,
  quantity_received: 3,
  ...over,
})

describe('progress', () => {
  it('counts what is still on its way', () => {
    expect(outstanding(line())).toBe(5)
    expect(outstanding(line({ quantity_received: 8 }))).toBe(0)
    expect(totalOutstanding([line(), line({ id: 'l2', quantity_sent: 2, quantity_received: 0 })])).toBe(7)
    expect(totalSent([line(), line({ quantity_sent: 2.5 })])).toBe(10.5)
  })
  it('names the state of a line', () => {
    expect(lineState(line({ quantity_received: 0 }), 'in_transit')).toBe('waiting')
    expect(lineState(line(), 'in_transit')).toBe('partial')
    expect(lineState(line({ quantity_received: 8 }), 'in_transit')).toBe('received')
    expect(lineState(line(), 'completed')).toBe('short')
    expect(lineState(line({ quantity_received: 8 }), 'completed')).toBe('received')
  })
})

describe('findLineByCode', () => {
  const lines = [line(), line({ id: 'l2', product_name: 'Oil', sku: 'O-1', barcode: null, qr_code: 'QR-OIL', quantity_sent: 2, quantity_received: 2 })]
  it('matches barcode, QR value and SKU (case-insensitive)', () => {
    expect(findLineByCode(lines, '8901234567890')?.id).toBe('l1')
    expect(findLineByCode(lines, 'QR-OIL')?.id).toBe('l2')
    expect(findLineByCode(lines, 'r-5')?.id).toBe('l1')
    expect(findLineByCode(lines, 'unknown')).toBeNull()
  })
  it('prefers a line that still has units outstanding', () => {
    const dup = [line({ id: 'done', quantity_received: 8 }), line({ id: 'open' })]
    expect(findLineByCode(dup, '8901234567890')?.id).toBe('open')
  })
})

describe('dispatch draft', () => {
  const rice = { id: 'p1', name: 'Rice', sku: 'R-5', unit: 'bag', quantity: 3 }

  it('adds items and increments on repeat scans', () => {
    let r = addToDraft([], rice)
    expect(r.ok && r.draft).toEqual([{ productId: 'p1', name: 'Rice', sku: 'R-5', unit: 'bag', available: 3, quantity: 1 }])
    r = addToDraft(r.ok ? r.draft : [], rice)
    expect(r.ok && r.draft[0]?.quantity).toBe(2)
  })

  it('never exceeds available stock', () => {
    const full: DraftLine[] = [{ productId: 'p1', name: 'Rice', sku: null, unit: 'bag', available: 3, quantity: 3 }]
    expect(addToDraft(full, rice)).toEqual({ ok: false, error: 'Only 3 bag of Rice available.' })
  })

  it('rejects empty stock and archived products', () => {
    expect(addToDraft([], { ...rice, quantity: 0 })).toEqual({ ok: false, error: 'Rice has no stock to transfer.' })
    expect(addToDraft([], { ...rice, archived_at: '2026-01-01' })).toMatchObject({ ok: false })
  })

  it('sets, caps and removes quantities', () => {
    const draft: DraftLine[] = [{ productId: 'p1', name: 'Rice', sku: null, unit: 'bag', available: 3, quantity: 1 }]
    expect(setDraftQuantity(draft, 'p1', 2)[0]?.quantity).toBe(2)
    expect(setDraftQuantity(draft, 'p1', 99)[0]?.quantity).toBe(3)
    expect(setDraftQuantity(draft, 'p1', 0)).toEqual([])
  })

  it('explains what is missing before dispatch', () => {
    const draft: DraftLine[] = [{ productId: 'p1', name: 'Rice', sku: null, unit: 'bag', available: 3, quantity: 2 }]
    expect(draftProblem(draft, null)).toMatch(/where/)
    expect(draftProblem([], 'dest')).toMatch(/at least one/)
    expect(draftProblem([{ ...draft[0]!, quantity: 5 }], 'dest')).toMatch(/only 3 bag available/)
    expect(draftProblem(draft, 'dest')).toBeNull()
    expect(toDispatchLines(draft)).toEqual([{ product_id: 'p1', quantity: 2 }])
  })
})
