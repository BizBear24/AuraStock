import type { Table } from './export'
import { roundQty } from './stock'

/** One product's raw figures for the period, as returned by stock_analysis(). */
export interface AnalysisInput {
  product_id: string
  name: string
  sku: string | null
  unit: string
  category: string | null
  quantity: number
  min_stock: number
  units_out: number
  units_in: number
  movements: number
  last_movement_at: string | null
  expires_on: string | null
}

/**
 * fast    top fifth of products by units sold/used in the period (needs at least 5 moving products)
 * slow    bottom fifth of moving products
 * dead    has stock but nothing went out during the whole period
 * normal  everything else
 */
export type Velocity = 'fast' | 'normal' | 'slow' | 'dead'

export interface AnalysisRow extends AnalysisInput {
  /** Average units out per day over the period. */
  dailyUsage: number
  /** How many days the current stock lasts at that rate; null when nothing is being used. */
  daysOfCover: number | null
  velocity: Velocity
  /** Units to order now to cover the planning horizon and stay at or above the minimum. */
  reorderQty: number
  /** Below minimum, or will run out within the planning horizon. */
  atRisk: boolean
  daysSinceMovement: number | null
}

export interface AnalysisOptions {
  /** Length of the period the figures cover. */
  days: number
  /** How far ahead reorder suggestions plan, in days. */
  horizonDays?: number
  now?: Date
}

const DAY = 24 * 60 * 60 * 1000

export function analyseStock(rows: AnalysisInput[], options: AnalysisOptions): AnalysisRow[] {
  const horizon = options.horizonDays ?? 14
  const now = (options.now ?? new Date()).getTime()
  const days = Math.max(1, options.days)

  const moving = rows.filter((r) => r.units_out > 0).sort((a, b) => b.units_out - a.units_out || a.name.localeCompare(b.name))
  const fifth = moving.length >= 5 ? Math.ceil(moving.length / 5) : 0
  const fast = new Set(moving.slice(0, fifth).map((r) => r.product_id))
  const slow = new Set(fifth ? moving.slice(-fifth).map((r) => r.product_id) : [])

  return rows.map((r) => {
    const dailyUsage = roundQty(r.units_out / days)
    const daysOfCover = dailyUsage > 0 ? Math.round((r.quantity / dailyUsage) * 10) / 10 : null
    const velocity: Velocity = r.quantity > 0 && r.units_out === 0 ? 'dead' : fast.has(r.product_id) ? 'fast' : slow.has(r.product_id) ? 'slow' : 'normal'
    const target = dailyUsage * horizon + r.min_stock
    const reorderQty = target > r.quantity ? Math.ceil(roundQty(target - r.quantity)) : 0
    const atRisk = r.quantity <= r.min_stock || (daysOfCover !== null && daysOfCover < horizon)
    const daysSinceMovement = r.last_movement_at ? Math.max(0, Math.floor((now - Date.parse(r.last_movement_at)) / DAY)) : null
    return { ...r, dailyUsage, daysOfCover, velocity, reorderQty, atRisk, daysSinceMovement }
  })
}

export interface AnalysisSummary {
  products: number
  atRisk: number
  toReorder: number
  fast: number
  slow: number
  dead: number
  unitsOut: number
}

export function summariseAnalysis(rows: AnalysisRow[]): AnalysisSummary {
  return {
    products: rows.length,
    atRisk: rows.filter((r) => r.atRisk).length,
    toReorder: rows.filter((r) => r.reorderQty > 0).length,
    fast: rows.filter((r) => r.velocity === 'fast').length,
    slow: rows.filter((r) => r.velocity === 'slow').length,
    dead: rows.filter((r) => r.velocity === 'dead').length,
    unitsOut: roundQty(rows.reduce((s, r) => s + r.units_out, 0)),
  }
}

export const VELOCITY_LABEL: Record<Velocity, string> = { fast: 'Fast mover', normal: 'Normal', slow: 'Slow mover', dead: 'No movement' }

export function analysisTable(rows: AnalysisRow[], days: number): Table {
  return {
    columns: [
      { header: 'Product', kind: 'text', width: 32 },
      { header: 'SKU', kind: 'text', width: 14 },
      { header: 'Category', kind: 'text', width: 16 },
      { header: 'On hand', kind: 'number', width: 10 },
      { header: 'Unit', kind: 'text', width: 7 },
      { header: 'Minimum', kind: 'number', width: 10 },
      { header: `Out (${days} d)`, kind: 'number', width: 11 },
      { header: `In (${days} d)`, kind: 'number', width: 10 },
      { header: 'Per day', kind: 'number', width: 9 },
      { header: 'Days of cover', kind: 'number', width: 13 },
      { header: 'Reorder', kind: 'number', width: 9 },
      { header: 'Movement', kind: 'text', width: 13 },
      { header: 'At risk', kind: 'text', width: 8 },
    ],
    rows: rows.map((r) => [
      r.name,
      r.sku,
      r.category,
      r.quantity,
      r.unit,
      r.min_stock,
      r.units_out,
      r.units_in,
      r.dailyUsage,
      r.daysOfCover,
      r.reorderQty,
      VELOCITY_LABEL[r.velocity],
      r.atRisk ? 'Yes' : 'No',
    ]),
  }
}
