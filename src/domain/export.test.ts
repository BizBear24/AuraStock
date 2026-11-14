import { csvSafe, movementsTable, productsTable, productStatus, type ExportProduct } from './export'

const base: ExportProduct = {
  name: 'Rice',
  sku: 'R-1',
  barcode: '111',
  qr_code: null,
  description: null,
  category: { name: 'Dry' },
  product_tags: [{ tags: { name: 'Bulk' } }, { tags: null }, { tags: { name: 'Staple' } }],
  quantity: 12.5,
  unit: 'kg',
  min_stock: 5,
  stock_state: 'ok',
  expires_on: null,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}
const today = new Date(2026, 10, 14)

describe('csvSafe', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvSafe('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvSafe('+1')).toBe("'+1")
    expect(csvSafe('-2')).toBe("'-2")
    expect(csvSafe('@cmd')).toBe("'@cmd")
    expect(csvSafe('\tx')).toBe("'\tx")
  })
  it('leaves ordinary text alone', () => {
    expect(csvSafe('Rice 5kg')).toBe('Rice 5kg')
    expect(csvSafe('')).toBe('')
  })
})

describe('productStatus', () => {
  it('prioritises archived, expired, out, expiring and low', () => {
    expect(productStatus({ ...base, archived_at: 'x' }, today)).toBe('Archived')
    expect(productStatus({ ...base, expires_on: '2026-11-01' }, today)).toBe('Expired')
    expect(productStatus({ ...base, stock_state: 'out' }, today)).toBe('Out of stock')
    expect(productStatus({ ...base, expires_on: '2026-11-20' }, today)).toBe('Expiring')
    expect(productStatus({ ...base, stock_state: 'low' }, today)).toBe('Low stock')
    expect(productStatus(base, today)).toBe('In stock')
  })
})

describe('productsTable', () => {
  it('lines columns up with rows and keeps numbers numeric', () => {
    const t = productsTable([base], today)
    expect(t.rows[0]).toHaveLength(t.columns.length)
    const row = Object.fromEntries(t.columns.map((c, i) => [c.header, t.rows[0]?.[i]]))
    expect(row).toMatchObject({ Name: 'Rice', Quantity: 12.5, 'Minimum stock': 5, Tags: 'Bulk, Staple', Category: 'Dry', Status: 'In stock', 'Expiration date': null })
  })
})

describe('movementsTable', () => {
  it('uses readable type names', () => {
    const t = movementsTable([
      { created_at: '2026-11-14T10:00:00Z', product_name: 'Rice', sku: 'R-1', movement_type: 'out', delta: -3, quantity_before: 8, quantity_after: 5, reference: null, note: null, user: 'Ada' },
    ])
    expect(t.rows[0]).toHaveLength(t.columns.length)
    expect(t.rows[0]?.[3]).toBe('Stock out')
    expect(t.rows[0]?.[4]).toBe(-3)
  })
})
