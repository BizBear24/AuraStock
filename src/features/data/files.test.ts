// @vitest-environment node
import { productsTable, type ExportProduct } from '@/domain/export'
import { autoMapColumns, buildExistingIndex, previewImport } from '@/domain/import'
import { parseCsv, parseXlsx, toCsv, toXlsx } from './files'

const product = (over: Partial<ExportProduct>): ExportProduct => ({
  name: 'Rice',
  sku: 'R-1',
  barcode: '4006381333931',
  qr_code: null,
  description: 'Long grain, "premium"',
  category: { name: 'Dry goods' },
  product_tags: [{ tags: { name: 'Bulk' } }],
  quantity: 12.5,
  unit: 'kg',
  min_stock: 5,
  stock_state: 'ok',
  expires_on: '2027-03-01',
  archived_at: null,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-02T10:00:00Z',
  ...over,
})

const text = async (b: Blob) => new TextDecoder().decode(await b.arrayBuffer())

describe('CSV', () => {
  it('writes a BOM, quotes values and neutralises formulas', async () => {
    const t = productsTable([product({}), product({ name: '=HYPERLINK("x")', sku: 'E-1', barcode: null })], new Date(2026, 10, 14))
    const blob = await toCsv(t)
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM for Excel
    const out = (await text(blob)).replace(/^\ufeff/, '')
    expect(out.startsWith('"Name"')).toBe(true)
    expect(out).toContain('"Long grain, ""premium"""')
    expect(out).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it('round-trips through the importer, including commas, quotes and unicode', async () => {
    const original = [product({ name: 'Café, “crème”', sku: 'C-1' })]
    const parsed = await parseCsv(await text(await toCsv(productsTable(original))))
    expect(parsed.headers[0]).toBe('Name')
    const preview = previewImport(parsed, autoMapColumns(parsed.headers), buildExistingIndex([]), { updateExisting: false, today: new Date(2026, 10, 14) })
    expect(preview.counts.invalid).toBe(0)
    expect(preview.rows[0]?.row).toMatchObject({ name: 'Café, “crème”', sku: 'C-1', unit: 'kg', min_stock: 5, quantity: 12.5, category: 'Dry goods', tags: ['Bulk'], expires_on: '2027-03-01' })
  })

  it('rejects an empty or header-only file', async () => {
    await expect(parseCsv('')).rejects.toThrow(/empty/)
    await expect(parseCsv('Name,SKU\n')).rejects.toThrow(/no data rows/)
  })
})

describe('XLSX', () => {
  it('writes real numbers, real dates, a frozen header and a filter', async () => {
    const ExcelJS = (await import('exceljs')).default
    const blob = await toXlsx(productsTable([product({})], new Date(2026, 10, 14)), 'Products')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const sheet = wb.worksheets[0]!
    expect(sheet.name).toBe('Products')
    expect(sheet.getRow(1).font?.bold).toBe(true)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    const qty = sheet.getCell('H2')
    expect(typeof qty.value).toBe('number')
    expect(qty.value).toBe(12.5)
    expect(qty.numFmt).toBe('#,##0.###')
    const expires = sheet.getCell('L2')
    expect(expires.value).toBeInstanceOf(Date)
    expect((expires.value as Date).toISOString().slice(0, 10)).toBe('2027-03-01')
    expect(expires.numFmt).toBe('yyyy-mm-dd')
  })

  it('round-trips through the importer', async () => {
    const parsed = await parseXlsx(await (await toXlsx(productsTable([product({ name: 'Flour' })]), 'Products')).arrayBuffer())
    expect(parsed.headers).toContain('Expiration date')
    const preview = previewImport(parsed, autoMapColumns(parsed.headers), buildExistingIndex([]), { updateExisting: false, today: new Date(2026, 10, 14) })
    expect(preview.counts).toMatchObject({ create: 1, invalid: 0 })
    expect(preview.rows[0]?.row).toMatchObject({ name: 'Flour', quantity: 12.5, expires_on: '2027-03-01' })
  })

  it('rejects files that are not workbooks', async () => {
    await expect(parseXlsx(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)).rejects.toThrow(/valid \.xlsx/)
  })
})
