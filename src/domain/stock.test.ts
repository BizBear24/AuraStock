import { evaluateMovement, roundQty, type MovementContext } from './stock'

const ctx = (over: Partial<MovementContext> = {}): MovementContext => ({
  current: 8,
  archived: false,
  expiresOn: null,
  today: new Date(2026, 10, 6),
  ...over,
})

describe('evaluateMovement', () => {
  it('adds stock', () => {
    expect(evaluateMovement('in', 5, ctx())).toEqual({ ok: true, delta: 5, after: 13 })
  })

  it('removes stock', () => {
    expect(evaluateMovement('out', 5, ctx())).toEqual({ ok: true, delta: -5, after: 3 })
  })

  it('rejects removing more than is available', () => {
    const r = evaluateMovement('out', 10, ctx())
    expect(r).toEqual({ ok: false, reason: 'Insufficient stock: 8 available, 10 requested' })
  })

  it('second removal of 5 from 8 fails once the first is applied', () => {
    const first = evaluateMovement('out', 5, ctx({ current: 8 }))
    expect(first.ok).toBe(true)
    const after = first.ok ? first.after : 0
    expect(evaluateMovement('out', 5, ctx({ current: after })).ok).toBe(false)
  })

  it('rejects zero and negative in/out amounts', () => {
    expect(evaluateMovement('in', 0, ctx()).ok).toBe(false)
    expect(evaluateMovement('out', -1, ctx()).ok).toBe(false)
    expect(evaluateMovement('in', Number.NaN, ctx()).ok).toBe(false)
  })

  it('computes the adjustment delta from the counted quantity and requires a note', () => {
    expect(evaluateMovement('adjustment', 6, ctx())).toMatchObject({ ok: false })
    expect(evaluateMovement('adjustment', 6, ctx({ note: 'stocktake' }))).toEqual({ ok: true, delta: -2, after: 6 })
    expect(evaluateMovement('adjustment', 8, ctx({ note: 'stocktake' })).ok).toBe(false)
    expect(evaluateMovement('adjustment', -1, ctx({ note: 'x' })).ok).toBe(false)
  })

  it('applies signed corrections but never below zero', () => {
    expect(evaluateMovement('correction', -3, ctx({ note: 'miscount' }))).toEqual({ ok: true, delta: -3, after: 5 })
    expect(evaluateMovement('correction', -9, ctx({ note: 'miscount' })).ok).toBe(false)
    expect(evaluateMovement('correction', 0, ctx({ note: 'x' })).ok).toBe(false)
    expect(evaluateMovement('correction', 2, ctx()).ok).toBe(false)
  })

  it('blocks stock in for expired products but allows stock out', () => {
    expect(evaluateMovement('in', 1, ctx({ expiresOn: '2026-11-05' })).ok).toBe(false)
    expect(evaluateMovement('out', 1, ctx({ expiresOn: '2026-11-05' })).ok).toBe(true)
    expect(evaluateMovement('in', 1, ctx({ expiresOn: '2026-11-06' })).ok).toBe(true)
  })

  it('blocks archived products', () => {
    expect(evaluateMovement('in', 1, ctx({ archived: true })).ok).toBe(false)
  })

  it('avoids floating point drift', () => {
    expect(evaluateMovement('in', 0.2, ctx({ current: 0.1 }))).toEqual({ ok: true, delta: 0.2, after: 0.3 })
    expect(roundQty(0.1 + 0.2)).toBe(0.3)
  })
})
