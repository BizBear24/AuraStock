// @vitest-environment node
import type { Product } from '@/features/products/types'
import type { Movement } from '@/features/stock/api'
import { buildPdfDocument } from './pdf'
import { inventoryReport, movementReport, stockSummaryReport } from './reports'

const generatedAt = new Date('2026-11-14T10:00:00Z')
const ctx = { organization: 'Acme Foods', inventory: 'Main', generatedAt }

const product = (i: number, over: Partial<Product> = {}): Product => ({
  id: `p${i}`,
  inventory_id: 'inv',
  name: `Product ${i}`,
  sku: `SKU-${i}`,
  barcode: null,
  qr_code: null,
  description: null,
  category_id: null,
  quantity: i % 7,
  unit: 'pcs',
  min_stock: 2,
  expires_on: null,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  stock_state: i % 7 === 0 ? 'out' : i % 7 <= 2 ? 'low' : 'ok',
  category: i % 2 ? { name: 'Dry' } : null,
  product_tags: [],
  details_version: 1,
  ...over,
})

const header = async (doc: Awaited<ReturnType<typeof buildPdfDocument>>) => new TextDecoder().decode(new Uint8Array(doc.output('arraybuffer')).slice(0, 5))

describe('PDF reports', () => {
  it('produces a valid multi-page inventory report', async () => {
    const products = Array.from({ length: 150 }, (_, i) => product(i + 1))
    const spec = inventoryReport(products, ctx)
    expect(spec.summary?.[0]).toEqual(['Products', '150'])
    const doc = await buildPdfDocument(spec)
    expect(await header(doc)).toBe('%PDF-')
    expect(doc.getNumberOfPages()).toBeGreaterThan(2)
  })

  it('excludes archived products from the inventory report', () => {
    const spec = inventoryReport([product(1), product(2, { archived_at: '2026-02-01T00:00:00Z' })], ctx)
    expect(spec.sections[0]?.table.rows).toHaveLength(1)
  })

  it('builds a stock summary with category totals and an attention list', async () => {
    const spec = stockSummaryReport([product(7), product(1), product(3, { expires_on: '2026-11-01' })], ctx)
    expect(spec.sections[0]?.heading).toBe('Stock by category')
    expect(spec.sections[1]?.table.rows.map((r) => r[0])).toEqual(['Product 3', 'Product 7', 'Product 1'])
    const doc = await buildPdfDocument(spec)
    expect(doc.getNumberOfPages()).toBe(1)
  })

  it('totals movements and handles an empty period', async () => {
    const mv = (delta: number): Movement => ({
      id: String(delta),
      product_id: 'p1',
      movement_type: delta > 0 ? 'in' : 'out',
      delta,
      quantity_before: 0,
      quantity_after: Math.max(0, delta),
      reference: null,
      note: null,
      created_at: '2026-11-13T09:30:00Z',
      product: { name: 'Rice', unit: 'kg', sku: null },
      author: { full_name: 'Ada', email: 'ada@x.test' },
    })
    const spec = movementReport([mv(10), mv(-4)], ctx, { fromLabel: '2026-11-01', toLabel: '2026-11-14' })
    expect(spec.summary).toEqual([['Movements', '2'], ['Units in', '10'], ['Units out', '4'], ['Net change', '6']])
    const empty = movementReport([], ctx, { fromLabel: 'a', toLabel: 'b' })
    expect(await header(await buildPdfDocument(empty))).toBe('%PDF-')
  })

  it('survives text a standard PDF font cannot draw', async () => {
    const doc = await buildPdfDocument(inventoryReport([product(1, { name: 'Рис 米 “quoted”' })], ctx))
    expect(doc.getNumberOfPages()).toBe(1)
  })
})
