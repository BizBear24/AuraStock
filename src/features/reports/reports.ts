import { productStatus, type Table } from '@/domain/export'
import { attentionList, summarizeProducts, totalsByCategory } from '@/domain/report'
import type { Product } from '@/features/products/types'
import type { Movement } from '@/features/stock/api'
import { MOVEMENT_LABEL } from '@/domain/stock'
import type { PdfSpec } from './pdf'

interface Context {
  organization: string
  inventory: string
  generatedAt: Date
}

const productColumns = [
  { header: 'Product', kind: 'text', width: 0 },
  { header: 'SKU', kind: 'text', width: 0 },
  { header: 'Category', kind: 'text', width: 0 },
  { header: 'Quantity', kind: 'number', width: 0 },
  { header: 'Unit', kind: 'text', width: 0 },
  { header: 'Minimum', kind: 'number', width: 0 },
  { header: 'Status', kind: 'text', width: 0 },
  { header: 'Expires', kind: 'date', width: 0 },
] as const

function productRows(products: Product[], today: Date): Table {
  return {
    columns: [...productColumns],
    rows: products.map((p) => [p.name, p.sku, p.category?.name ?? null, p.quantity, p.unit, p.min_stock, productStatus(p, today), p.expires_on]),
  }
}

const subtitle = (c: Context) => `${c.organization} - ${c.inventory}`

/** Full inventory listing with a summary strip. Archived products are excluded. */
export function inventoryReport(products: Product[], c: Context): PdfSpec {
  const active = products.filter((p) => !p.archived_at).sort((a, b) => a.name.localeCompare(b.name))
  const s = summarizeProducts(active, c.generatedAt)
  return {
    title: 'Inventory report',
    subtitle: subtitle(c),
    generatedAt: c.generatedAt,
    landscape: true,
    summary: [
      ['Products', String(s.products)],
      ['Units in stock', String(Math.round(s.units * 1000) / 1000)],
      ['Low stock', String(s.low)],
      ['Out of stock', String(s.out)],
      ['Expiring (30 d)', String(s.expiring)],
      ['Expired', String(s.expired)],
    ],
    sections: [{ heading: `All active products (${active.length})`, table: productRows(active, c.generatedAt), emptyText: 'This inventory has no active products.' }],
  }
}

/** Totals per category plus everything that needs action. */
export function stockSummaryReport(products: Product[], c: Context): PdfSpec {
  const s = summarizeProducts(products, c.generatedAt)
  const categories = totalsByCategory(products)
  const attention = attentionList(products, c.generatedAt)
  return {
    title: 'Stock summary',
    subtitle: subtitle(c),
    generatedAt: c.generatedAt,
    summary: [
      ['Products', String(s.products)],
      ['Units', String(Math.round(s.units * 1000) / 1000)],
      ['Low', String(s.low)],
      ['Out', String(s.out)],
      ['Expiring', String(s.expiring)],
      ['Expired', String(s.expired)],
    ],
    sections: [
      {
        heading: 'Stock by category',
        table: {
          columns: [
            { header: 'Category', kind: 'text', width: 0 },
            { header: 'Products', kind: 'number', width: 0 },
            { header: 'Units', kind: 'number', width: 0 },
          ],
          rows: categories.map((g) => [g.category, g.products, Math.round(g.units * 1000) / 1000]),
        },
        emptyText: 'No products.',
      },
      { heading: `Needs attention (${attention.length})`, table: productRows(attention, c.generatedAt), emptyText: 'Nothing needs attention.' },
    ],
  }
}

export interface MovementReportRange {
  fromLabel: string
  toLabel: string
}

/** Chronological movements with in/out totals for the period. */
export function movementReport(movements: Movement[], c: Context, range: MovementReportRange): PdfSpec {
  const unitsIn = movements.filter((m) => m.delta > 0).reduce((s, m) => s + m.delta, 0)
  const unitsOut = movements.filter((m) => m.delta < 0).reduce((s, m) => s - m.delta, 0)
  return {
    title: 'Stock movement report',
    subtitle: `${subtitle(c)} - ${range.fromLabel} to ${range.toLabel}`,
    generatedAt: c.generatedAt,
    landscape: true,
    summary: [
      ['Movements', String(movements.length)],
      ['Units in', String(Math.round(unitsIn * 1000) / 1000)],
      ['Units out', String(Math.round(unitsOut * 1000) / 1000)],
      ['Net change', String(Math.round((unitsIn - unitsOut) * 1000) / 1000)],
    ],
    sections: [
      {
        heading: 'Movements',
        table: {
          columns: [
            { header: 'Date and time', kind: 'datetime', width: 0 },
            { header: 'Product', kind: 'text', width: 0 },
            { header: 'Type', kind: 'text', width: 0 },
            { header: 'Change', kind: 'number', width: 0 },
            { header: 'Balance', kind: 'number', width: 0 },
            { header: 'Reference', kind: 'text', width: 0 },
            { header: 'Note', kind: 'text', width: 0 },
            { header: 'User', kind: 'text', width: 0 },
          ],
          rows: movements.map((m) => [
            m.created_at,
            m.product?.name ?? null,
            MOVEMENT_LABEL[m.movement_type],
            m.delta,
            m.quantity_after,
            m.reference,
            m.note,
            m.author?.full_name ?? m.author?.email ?? null,
          ]),
        },
        emptyText: 'No stock movements in this period.',
      },
    ],
  }
}
