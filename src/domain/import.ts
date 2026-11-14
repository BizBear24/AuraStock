import { parseNameList, toDateString } from './product-status'

export const IMPORT_FIELDS = ['name', 'sku', 'barcode', 'qr_code', 'description', 'category', 'tags', 'unit', 'min_stock', 'expires_on', 'quantity'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const FIELD_LABEL: Record<ImportField, string> = {
  name: 'Name',
  sku: 'SKU',
  barcode: 'Barcode',
  qr_code: 'QR code value',
  description: 'Description',
  category: 'Category',
  tags: 'Tags',
  unit: 'Unit',
  min_stock: 'Minimum stock',
  expires_on: 'Expiration date',
  quantity: 'Opening quantity',
}

const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'productname', 'product', 'item', 'itemname', 'title'],
  sku: ['sku', 'itemcode', 'productcode', 'code', 'article', 'articlenumber'],
  barcode: ['barcode', 'ean', 'ean13', 'upc', 'upca', 'gtin'],
  qr_code: ['qr', 'qrcode', 'qrvalue', 'qrcodevalue'],
  description: ['description', 'desc', 'details', 'notes'],
  category: ['category', 'group', 'department'],
  tags: ['tags', 'labels', 'keywords'],
  unit: ['unit', 'uom', 'unitofmeasure', 'unitofmeasurement'],
  min_stock: ['minstock', 'minimumstock', 'minimum', 'min', 'reorderlevel', 'reorderpoint', 'threshold', 'lowstock'],
  expires_on: ['expires', 'expireson', 'expiry', 'expirydate', 'expiration', 'expirationdate', 'bestbefore'],
  quantity: ['quantity', 'qty', 'stock', 'onhand', 'instock', 'openingstock', 'balance'],
}

export const MAX_IMPORT_ROWS = 5000

/** Rows are arrays of cell text; the first row of the source is the header. */
export interface RawTable {
  headers: string[]
  rows: string[][]
}

/** Column index per field, or null when not mapped. */
export type ColumnMapping = Record<ImportField, number | null>

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Suggest a mapping from header names. Each column is used at most once; exact synonym matches win. */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader)
  const used = new Set<number>()
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ColumnMapping
  for (const field of IMPORT_FIELDS) {
    const index = normalized.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(h))
    if (index >= 0) {
      mapping[field] = index
      used.add(index)
    }
  }
  return mapping
}

export function mappingProblems(mapping: ColumnMapping): string[] {
  const problems: string[] = []
  if (mapping.name === null) problems.push('Choose which column holds the product name.')
  const cols = Object.values(mapping).filter((v): v is number => v !== null)
  if (new Set(cols).size !== cols.length) problems.push('Each column can be used for only one field.')
  return problems
}

/** Turn raw cell grids into a table: the first non-empty row is the header; duplicate/blank headers get names. */
export function tableFromGrid(grid: string[][]): RawTable {
  const first = grid.findIndex((r) => r.some((c) => c.trim() !== ''))
  if (first < 0) return { headers: [], rows: [] }
  const seen = new Map<string, number>()
  const headers = (grid[first] ?? []).map((raw, i) => {
    const base = raw.trim() || `Column ${i + 1}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base} (${count})`
  })
  return { headers, rows: grid.slice(first + 1) }
}

// ---------------------------------------------------------------- cell parsing

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Non-negative number with up to 3 decimals and a dot as the decimal separator. Blank means "not provided". */
export function parseQuantity(text: string, label: string): Parsed<number | null> {
  const t = text.trim()
  if (t === '') return { ok: true, value: null }
  if (/^\d+,\d{1,3}$/.test(t)) return { ok: false, error: `${label}: use a dot as the decimal separator ("${t}")` }
  if (/^-/.test(t) && /^-\d+(\.\d+)?$/.test(t)) return { ok: false, error: `${label} cannot be negative` }
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return { ok: false, error: `${label} must be a number with at most 3 decimals ("${t}")` }
  const value = Number(t)
  if (value > 99_999_999) return { ok: false, error: `${label} is too large` }
  return { ok: true, value }
}

/** Accepts YYYY-MM-DD or YYYY/MM/DD (real calendar dates only). Ambiguous day/month formats are rejected. */
export function parseIsoDate(text: string): Parsed<string | null> {
  const t = text.trim()
  if (t === '') return { ok: true, value: null }
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t)
  if (!m) return { ok: false, error: `Expiration date must be YYYY-MM-DD ("${t}")` }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return { ok: false, error: `Expiration date is not a real date ("${t}")` }
  }
  return { ok: true, value: `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

export function splitTags(text: string): string[] {
  return parseNameList(text.replace(/[;|]/g, ','), 1000)
}

// ---------------------------------------------------------------- validation

export interface ImportRow {
  name: string
  sku: string | null
  barcode: string | null
  qr_code: string | null
  description: string | null
  category: string | null
  tags: string[]
  unit: string
  min_stock: number
  expires_on: string | null
  quantity: number
}

export type RowAction = 'create' | 'update' | 'skip' | 'invalid'

export interface PreviewRow {
  /** Line number in the source file (header is line 1). */
  line: number
  action: RowAction
  row: ImportRow | null
  errors: string[]
  notes: string[]
}

export interface ExistingProductKeys {
  id: string
  sku: string | null
  barcode: string | null
  qr_code: string | null
}

export interface ExistingIndex {
  bySku: Map<string, string>
  byBarcode: Map<string, string>
  byQr: Map<string, string>
}

export function buildExistingIndex(products: ExistingProductKeys[]): ExistingIndex {
  const index: ExistingIndex = { bySku: new Map(), byBarcode: new Map(), byQr: new Map() }
  for (const p of products) {
    if (p.sku) index.bySku.set(p.sku.toLowerCase(), p.id)
    if (p.barcode) index.byBarcode.set(p.barcode, p.id)
    if (p.qr_code) index.byQr.set(p.qr_code, p.id)
  }
  return index
}

export interface ImportPreview {
  rows: PreviewRow[]
  counts: Record<RowAction, number>
  /** More rows than MAX_IMPORT_ROWS were supplied; nothing beyond the limit was read. */
  overLimit: boolean
}

const LIMITS = { name: 200, sku: 80, barcode: 128, qr_code: 512, description: 2000, category: 60, unit: 20, tag: 40 } as const

export interface PreviewOptions {
  updateExisting: boolean
  today?: Date
}

export function previewImport(table: RawTable, mapping: ColumnMapping, existing: ExistingIndex, options: PreviewOptions): ImportPreview {
  const today = toDateString(options.today ?? new Date())
  const cell = (row: string[], field: ImportField): string => {
    const i = mapping[field]
    return i === null ? '' : (row[i] ?? '').trim()
  }
  const seen = { sku: new Map<string, number>(), barcode: new Map<string, number>(), qr: new Map<string, number>() }
  const rows: PreviewRow[] = []
  const overLimit = table.rows.length > MAX_IMPORT_ROWS

  table.rows.slice(0, MAX_IMPORT_ROWS).forEach((raw, i) => {
    if (raw.every((c) => c.trim() === '')) return
    const line = i + 2
    const errors: string[] = []
    const notes: string[] = []

    const text = (field: ImportField, max: number, label: string): string | null => {
      const v = cell(raw, field)
      if (v.length > max) errors.push(`${label} is longer than ${max} characters`)
      return v === '' ? null : v
    }

    const name = text('name', LIMITS.name, 'Name')
    if (name === null) errors.push('Name is required')
    const sku = text('sku', LIMITS.sku, 'SKU')
    const barcode = text('barcode', LIMITS.barcode, 'Barcode')
    const qr = text('qr_code', LIMITS.qr_code, 'QR code value')
    const description = text('description', LIMITS.description, 'Description')
    const category = text('category', LIMITS.category, 'Category')
    const unit = text('unit', LIMITS.unit, 'Unit') ?? 'pcs'
    const tags = splitTags(cell(raw, 'tags'))
    if (tags.some((t) => t.length > LIMITS.tag)) errors.push(`A tag is longer than ${LIMITS.tag} characters`)

    const min = parseQuantity(cell(raw, 'min_stock'), 'Minimum stock')
    if (!min.ok) errors.push(min.error)
    const qty = parseQuantity(cell(raw, 'quantity'), 'Opening quantity')
    if (!qty.ok) errors.push(qty.error)
    const expires = parseIsoDate(cell(raw, 'expires_on'))
    if (!expires.ok) errors.push(expires.error)

    // Duplicates inside the file.
    const dupe = (map: Map<string, number>, key: string | null, label: string, display: string | null) => {
      if (!key) return
      const prior = map.get(key)
      if (prior !== undefined) errors.push(`Duplicate ${label} "${display}" (also on line ${prior})`)
      else map.set(key, line)
    }
    dupe(seen.sku, sku?.toLowerCase() ?? null, 'SKU', sku)
    dupe(seen.barcode, barcode, 'barcode', barcode)
    dupe(seen.qr, qr, 'QR code', qr)

    // Matches against products already in the inventory.
    const matches = new Set<string>()
    const bySku = sku ? existing.bySku.get(sku.toLowerCase()) : undefined
    const byBarcode = barcode ? existing.byBarcode.get(barcode) : undefined
    const byQr = qr ? existing.byQr.get(qr) : undefined
    for (const id of [bySku, byBarcode, byQr]) if (id) matches.add(id)
    if (matches.size > 1) errors.push('SKU, barcode and QR value match more than one existing product')

    const quantity = qty.ok ? (qty.value ?? 0) : 0
    const expiresOn = expires.ok ? expires.value : null
    if (matches.size === 0 && quantity > 0 && expiresOn !== null && expiresOn < today) {
      errors.push('Opening stock cannot be added to an already expired product')
    }

    if (errors.length > 0 || name === null) {
      rows.push({ line, action: 'invalid', row: null, errors, notes })
      return
    }

    const value: ImportRow = {
      name,
      sku,
      barcode,
      qr_code: qr,
      description,
      category,
      tags,
      unit,
      min_stock: min.ok ? (min.value ?? 0) : 0,
      expires_on: expiresOn,
      quantity,
    }
    if (matches.size === 1) {
      if (quantity > 0) notes.push('Opening quantity is ignored for existing products')
      rows.push({ line, action: options.updateExisting ? 'update' : 'skip', row: value, errors, notes: options.updateExisting ? notes : ['Already exists'] })
    } else {
      rows.push({ line, action: 'create', row: value, errors, notes })
    }
  })

  const counts: Record<RowAction, number> = { create: 0, update: 0, skip: 0, invalid: 0 }
  for (const r of rows) counts[r.action] += 1
  return { rows, counts, overLimit }
}

/** Replace the database's "Row n:" (position among rows sent) with the real line numbers of the file. */
export function explainImportError(message: string, lines: number[]): string {
  return message.replace(/Row (\d+):/, (_all, n: string) => {
    const line = lines[Number(n) - 1]
    return line === undefined ? `Row ${n}:` : `Line ${line}:`
  })
}
