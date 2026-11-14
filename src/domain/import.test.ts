import {
  autoMapColumns,
  buildExistingIndex,
  explainImportError,
  mappingProblems,
  parseIsoDate,
  parseQuantity,
  previewImport,
  splitTags,
  tableFromGrid,
  type ColumnMapping,
  type RawTable,
} from './import'

const today = new Date(2026, 10, 14)
const none = buildExistingIndex([])
const opts = { updateExisting: false, today }

const table = (headers: string[], ...rows: string[][]): RawTable => ({ headers, rows })

describe('autoMapColumns', () => {
  it('recognises common header names and uses each column once', () => {
    const m = autoMapColumns(['Product Name', 'Item Code', 'EAN', 'Qty', 'Min Stock', 'Expiry Date', 'Category', 'Tags', 'UoM', 'Notes'])
    expect(m).toMatchObject({ name: 0, sku: 1, barcode: 2, quantity: 3, min_stock: 4, expires_on: 5, category: 6, tags: 7, unit: 8, description: 9 })
    expect(m.qr_code).toBeNull()
  })
  it('requires a name column and rejects reusing a column', () => {
    const base = autoMapColumns(['x'])
    expect(mappingProblems(base)[0]).toMatch(/product name/)
    const clash = { ...base, name: 0, sku: 0 } as ColumnMapping
    expect(mappingProblems(clash).join(' ')).toMatch(/only one field/)
  })
})

describe('tableFromGrid', () => {
  it('skips leading blank rows and names blank or repeated headers', () => {
    const t = tableFromGrid([['', ''], ['Name', 'Name', ''], ['a', 'b', 'c']])
    expect(t.headers).toEqual(['Name', 'Name (2)', 'Column 3'])
    expect(t.rows).toEqual([['a', 'b', 'c']])
  })
  it('handles an empty sheet', () => {
    expect(tableFromGrid([])).toEqual({ headers: [], rows: [] })
  })
})

describe('cell parsing', () => {
  it('parses quantities strictly', () => {
    expect(parseQuantity('', 'Q')).toEqual({ ok: true, value: null })
    expect(parseQuantity(' 12.5 ', 'Q')).toEqual({ ok: true, value: 12.5 })
    expect(parseQuantity('1,5', 'Q')).toMatchObject({ ok: false, error: expect.stringContaining('dot') })
    expect(parseQuantity('-3', 'Q')).toMatchObject({ ok: false, error: expect.stringContaining('negative') })
    expect(parseQuantity('abc', 'Q').ok).toBe(false)
    expect(parseQuantity('1.2345', 'Q').ok).toBe(false)
  })
  it('parses real ISO dates only', () => {
    expect(parseIsoDate('2026-02-05')).toEqual({ ok: true, value: '2026-02-05' })
    expect(parseIsoDate('2026/2/5')).toEqual({ ok: true, value: '2026-02-05' })
    expect(parseIsoDate('2026-02-30').ok).toBe(false)
    expect(parseIsoDate('05/02/2026').ok).toBe(false)
    expect(parseIsoDate('')).toEqual({ ok: true, value: null })
  })
  it('splits tags on commas, semicolons and pipes', () => {
    expect(splitTags('Cold; Fragile|cold, Dry')).toEqual(['Cold', 'Fragile', 'Dry'])
  })
})

describe('previewImport', () => {
  const headers = ['Name', 'SKU', 'Barcode', 'Quantity', 'Expires']
  const mapping = autoMapColumns(headers)

  it('classifies valid rows as creates and ignores blank lines', () => {
    const p = previewImport(table(headers, ['Rice', 'R-1', '111', '5', ''], ['', '', '', '', ''], ['Beans', 'B-1', '', '', '']), mapping, none, opts)
    expect(p.counts).toEqual({ create: 2, update: 0, skip: 0, invalid: 0 })
    expect(p.rows.map((r) => r.line)).toEqual([2, 4])
    expect(p.rows[0]?.row).toMatchObject({ name: 'Rice', quantity: 5, unit: 'pcs', min_stock: 0 })
  })

  it('reports every problem with its line instead of silently dropping rows', () => {
    const p = previewImport(table(headers, ['', 'X-1', '', '', ''], ['Bad qty', 'X-2', '', 'abc', ''], ['Bad date', 'X-3', '', '', '31/12/2026']), mapping, none, opts)
    expect(p.counts.invalid).toBe(3)
    expect(p.rows[0]?.errors).toContain('Name is required')
    expect(p.rows[1]?.errors[0]).toMatch(/Opening quantity must be a number/)
    expect(p.rows[2]?.errors[0]).toMatch(/YYYY-MM-DD/)
  })

  it('detects duplicates within the file', () => {
    const p = previewImport(table(headers, ['A', 'S-1', '9', '', ''], ['B', 's-1', '8', '', ''], ['C', 'S-3', '9', '', '']), mapping, none, opts)
    expect(p.rows.map((r) => r.action)).toEqual(['create', 'invalid', 'invalid'])
    expect(p.rows[1]?.errors[0]).toBe('Duplicate SKU "s-1" (also on line 2)')
    expect(p.rows[2]?.errors[0]).toBe('Duplicate barcode "9" (also on line 2)')
  })

  it('skips or updates products that already exist', () => {
    const existing = buildExistingIndex([{ id: 'p1', sku: 'R-1', barcode: null, qr_code: null }])
    const t = table(headers, ['Rice 2', 'r-1', '', '10', ''])
    expect(previewImport(t, mapping, existing, opts).rows[0]).toMatchObject({ action: 'skip', notes: ['Already exists'] })
    const upd = previewImport(t, mapping, existing, { ...opts, updateExisting: true }).rows[0]
    expect(upd?.action).toBe('update')
    expect(upd?.notes).toContain('Opening quantity is ignored for existing products')
  })

  it('rejects rows whose keys point at different existing products', () => {
    const existing = buildExistingIndex([
      { id: 'p1', sku: 'A', barcode: null, qr_code: null },
      { id: 'p2', sku: null, barcode: '222', qr_code: null },
    ])
    const p = previewImport(table(headers, ['X', 'A', '222', '', '']), mapping, existing, opts)
    expect(p.rows[0]?.action).toBe('invalid')
    expect(p.rows[0]?.errors[0]).toMatch(/more than one existing product/)
  })

  it('blocks opening stock on expired products', () => {
    const p = previewImport(table(headers, ['Old milk', 'M-1', '', '3', '2026-01-01'], ['Old milk, no stock', 'M-2', '', '', '2026-01-01']), mapping, none, opts)
    expect(p.rows[0]?.action).toBe('invalid')
    expect(p.rows[1]?.action).toBe('create')
  })

  it('flags over-long values and caps the number of rows', () => {
    const long = previewImport(table(headers, ['x'.repeat(201), '', '', '', '']), mapping, none, opts)
    expect(long.rows[0]?.errors[0]).toMatch(/Name is longer than 200/)
    const many = previewImport({ headers, rows: Array.from({ length: 5001 }, (_, i) => [`n${i}`, '', '', '', '']) }, mapping, none, opts)
    expect(many.overLimit).toBe(true)
    expect(many.rows).toHaveLength(5000)
  })
})

describe('explainImportError', () => {
  it('maps database row positions back to file lines', () => {
    expect(explainImportError('Row 2: name is required', [5, 9, 12])).toBe('Line 9: name is required')
    expect(explainImportError('Row 9: x', [5])).toBe('Row 9: x')
    expect(explainImportError('Other error', [5])).toBe('Other error')
  })
})
