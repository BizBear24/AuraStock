import { analyseStock, analysisTable, summariseAnalysis, type AnalysisInput } from './analysis'

const now = new Date('2026-11-18T12:00:00Z')
const row = (id: string, over: Partial<AnalysisInput> = {}): AnalysisInput => ({
  product_id: id,
  name: id,
  sku: null,
  unit: 'pcs',
  category: null,
  quantity: 30,
  min_stock: 5,
  units_out: 30,
  units_in: 0,
  movements: 4,
  last_movement_at: '2026-11-17T12:00:00Z',
  expires_on: null,
  ...over,
})

describe('analyseStock', () => {
  it('computes usage, cover and reorder suggestions', () => {
    const [r] = analyseStock([row('rice', { quantity: 10, units_out: 60, min_stock: 5 })], { days: 30, horizonDays: 14, now })
    expect(r!.dailyUsage).toBe(2)
    expect(r!.daysOfCover).toBe(5)
    expect(r!.reorderQty).toBe(23) // 2/day * 14 + 5 minimum - 10 on hand
    expect(r!.atRisk).toBe(true) // runs out in 5 days, within the 14-day horizon
    expect(r!.daysSinceMovement).toBe(1)
  })

  it('suggests nothing when stock already covers the horizon', () => {
    const [r] = analyseStock([row('flour', { quantity: 100, units_out: 30, min_stock: 5 })], { days: 30, now })
    expect(r!.daysOfCover).toBe(100)
    expect(r!.reorderQty).toBe(0)
    expect(r!.atRisk).toBe(false)
  })

  it('flags stock that is not moving and items below their minimum', () => {
    const [dead, low] = analyseStock(
      [row('mugs', { quantity: 12, units_out: 0, last_movement_at: '2026-08-01T00:00:00Z' }), row('salt', { quantity: 2, units_out: 0, min_stock: 5 })],
      { days: 30, now },
    )
    expect(dead!.velocity).toBe('dead')
    expect(dead!.daysOfCover).toBeNull()
    expect(dead!.reorderQty).toBe(0)
    expect(dead!.daysSinceMovement).toBe(109)
    expect(low!.atRisk).toBe(true)
    expect(low!.reorderQty).toBe(3) // back up to the minimum
  })

  it('ranks fast and slow movers only with enough products to compare', () => {
    const many = Array.from({ length: 10 }, (_, i) => row(`p${i}`, { units_out: (i + 1) * 10, quantity: 500 }))
    const result = analyseStock(many, { days: 30, now })
    expect(result.filter((r) => r.velocity === 'fast').map((r) => r.product_id)).toEqual(['p8', 'p9'])
    expect(result.filter((r) => r.velocity === 'slow').map((r) => r.product_id)).toEqual(['p0', 'p1'])
    const few = analyseStock(many.slice(0, 3), { days: 30, now })
    expect(few.every((r) => r.velocity === 'normal')).toBe(true)
  })

  it('handles out-of-stock items that are not used, and fractional units', () => {
    const [empty, kg] = analyseStock([row('gone', { quantity: 0, units_out: 0, min_stock: 0 }), row('cheese', { quantity: 1.5, units_out: 4.5, min_stock: 1, unit: 'kg' })], { days: 30, now })
    expect(empty!.velocity).toBe('normal')
    expect(empty!.atRisk).toBe(true) // 0 is at the minimum of 0
    expect(kg!.dailyUsage).toBe(0.15)
    expect(kg!.daysOfCover).toBe(10)
    expect(kg!.reorderQty).toBe(2) // 0.15 * 14 + 1 - 1.5 = 1.6, rounded up to whole units
  })
})

describe('summary and export', () => {
  it('summarises and tabulates', () => {
    const rows = analyseStock([row('a', { quantity: 1, units_out: 30 }), row('b', { quantity: 10, units_out: 0 })], { days: 30, now })
    expect(summariseAnalysis(rows)).toEqual({ products: 2, atRisk: 1, toReorder: 1, fast: 0, slow: 0, dead: 1, unitsOut: 30 })
    const t = analysisTable(rows, 30)
    expect(t.columns[6]!.header).toBe('Out (30 d)')
    expect(t.rows[0]).toHaveLength(t.columns.length)
    expect(t.rows[1]![11]).toBe('No movement')
  })
})
