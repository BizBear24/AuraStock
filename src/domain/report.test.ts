import { attentionList, pdfText, summarizeProducts, totalsByCategory, type ReportProduct } from './report'

const today = new Date(2026, 10, 14)
const p = (over: Partial<ReportProduct>): ReportProduct => ({
  name: 'X',
  category: null,
  quantity: 5,
  min_stock: 2,
  stock_state: 'ok',
  expires_on: null,
  archived_at: null,
  ...over,
})

const sample: ReportProduct[] = [
  p({ name: 'Rice', category: { name: 'Dry' }, quantity: 10 }),
  p({ name: 'Beans', category: { name: 'Dry' }, quantity: 1, stock_state: 'low' }),
  p({ name: 'Milk', category: { name: 'Dairy' }, quantity: 0, stock_state: 'out' }),
  p({ name: 'Yogurt', category: { name: 'Dairy' }, quantity: 4, expires_on: '2026-11-20' }),
  p({ name: 'Cheese', category: { name: 'Dairy' }, quantity: 2, expires_on: '2026-11-01' }),
  p({ name: 'Old', quantity: 99, archived_at: '2026-01-01' }),
]

describe('summarizeProducts', () => {
  it('counts active products only', () => {
    expect(summarizeProducts(sample, today)).toEqual({ products: 5, units: 17, low: 1, out: 1, expiring: 1, expired: 1 })
  })
})

describe('totalsByCategory', () => {
  it('groups, sums and sorts by units', () => {
    expect(totalsByCategory(sample)).toEqual([
      { category: 'Dry', products: 2, units: 11 },
      { category: 'Dairy', products: 3, units: 6 },
    ])
  })
  it('uses Uncategorized for products without a category', () => {
    expect(totalsByCategory([p({ quantity: 3 })])).toEqual([{ category: 'Uncategorized', products: 1, units: 3 }])
  })
})

describe('attentionList', () => {
  it('lists expired, out, expiring then low, excluding healthy and archived products', () => {
    expect(attentionList(sample, today).map((x) => x.name)).toEqual(['Cheese', 'Milk', 'Yogurt', 'Beans'])
  })
})

describe('pdfText', () => {
  it('maps typographic characters and replaces unsupported ones', () => {
    expect(pdfText('It’s “fine” – really…')).toBe('It\'s "fine" - really...')
    expect(pdfText('Café')).toBe('Café')
    expect(pdfText('Рис 米')).toBe('??? ?')
  })
})
