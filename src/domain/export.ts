import { expiryState, type StockState } from './product-status'
import { MOVEMENT_LABEL, type MovementType } from './stock'

export type ColumnKind = 'text' | 'number' | 'date' | 'datetime'

export interface TableColumn {
  header: string
  kind: ColumnKind
  /** Approximate width in characters for spreadsheet output. */
  width: number
}

/** Format-independent tabular data shared by CSV, XLSX and PDF writers. Dates are ISO strings. */
export interface Table {
  columns: TableColumn[]
  rows: (string | number | null)[][]
}

/**
 * Spreadsheet applications treat cells starting with = + - @ (or tab / carriage return) as formulas.
 * Prefixing a single quote neutralises them ("CSV injection"). Applied to text cells in CSV output.
 */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export interface ExportProduct {
  name: string
  sku: string | null
  barcode: string | null
  qr_code: string | null
  description: string | null
  category: { name: string } | null
  product_tags: { tags: { name: string } | null }[]
  quantity: number
  unit: string
  min_stock: number
  stock_state: StockState
  expires_on: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export function productStatus(p: Pick<ExportProduct, 'stock_state' | 'expires_on' | 'archived_at'>, today: Date = new Date()): string {
  if (p.archived_at) return 'Archived'
  const expiry = expiryState(p.expires_on, today)
  if (expiry === 'expired') return 'Expired'
  if (p.stock_state === 'out') return 'Out of stock'
  if (expiry === 'expiring') return 'Expiring'
  if (p.stock_state === 'low') return 'Low stock'
  return 'In stock'
}

export function productsTable(products: ExportProduct[], today: Date = new Date()): Table {
  const columns: TableColumn[] = [
    { header: 'Name', kind: 'text', width: 32 },
    { header: 'SKU', kind: 'text', width: 16 },
    { header: 'Barcode', kind: 'text', width: 18 },
    { header: 'QR code value', kind: 'text', width: 20 },
    { header: 'Description', kind: 'text', width: 36 },
    { header: 'Category', kind: 'text', width: 18 },
    { header: 'Tags', kind: 'text', width: 22 },
    { header: 'Quantity', kind: 'number', width: 11 },
    { header: 'Unit', kind: 'text', width: 8 },
    { header: 'Minimum stock', kind: 'number', width: 14 },
    { header: 'Status', kind: 'text', width: 14 },
    { header: 'Expiration date', kind: 'date', width: 15 },
    { header: 'Created', kind: 'datetime', width: 20 },
    { header: 'Updated', kind: 'datetime', width: 20 },
  ]
  const rows = products.map((p) => [
    p.name,
    p.sku,
    p.barcode,
    p.qr_code,
    p.description,
    p.category?.name ?? null,
    p.product_tags.flatMap((t) => (t.tags ? [t.tags.name] : [])).join(', ') || null,
    p.quantity,
    p.unit,
    p.min_stock,
    productStatus(p, today),
    p.expires_on,
    p.created_at,
    p.updated_at,
  ])
  return { columns, rows }
}

export interface ExportMovement {
  created_at: string
  product_name: string | null
  sku: string | null
  movement_type: MovementType
  delta: number
  quantity_before: number
  quantity_after: number
  reference: string | null
  note: string | null
  user: string | null
}

export function movementsTable(movements: ExportMovement[]): Table {
  const columns: TableColumn[] = [
    { header: 'Date and time', kind: 'datetime', width: 20 },
    { header: 'Product', kind: 'text', width: 32 },
    { header: 'SKU', kind: 'text', width: 16 },
    { header: 'Type', kind: 'text', width: 12 },
    { header: 'Change', kind: 'number', width: 10 },
    { header: 'Quantity before', kind: 'number', width: 15 },
    { header: 'Quantity after', kind: 'number', width: 14 },
    { header: 'Reference', kind: 'text', width: 16 },
    { header: 'Note', kind: 'text', width: 32 },
    { header: 'User', kind: 'text', width: 24 },
  ]
  const rows = movements.map((m) => [
    m.created_at,
    m.product_name,
    m.sku,
    MOVEMENT_LABEL[m.movement_type],
    m.delta,
    m.quantity_before,
    m.quantity_after,
    m.reference,
    m.note,
    m.user,
  ])
  return { columns, rows }
}
