import { roundQty } from './stock'

export type TransferStatus = 'in_transit' | 'completed' | 'cancelled'

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  in_transit: 'In transit',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export interface TransferLineLike {
  id: string
  product_name: string
  sku: string | null
  barcode: string | null
  qr_code: string | null
  quantity_sent: number
  quantity_received: number
}

/** Units of a line that have not arrived yet. */
export function outstanding(line: Pick<TransferLineLike, 'quantity_sent' | 'quantity_received'>): number {
  return Math.max(0, roundQty(line.quantity_sent - line.quantity_received))
}

export function totalOutstanding(lines: Pick<TransferLineLike, 'quantity_sent' | 'quantity_received'>[]): number {
  return roundQty(lines.reduce((sum, l) => sum + outstanding(l), 0))
}

export function totalSent(lines: Pick<TransferLineLike, 'quantity_sent'>[]): number {
  return roundQty(lines.reduce((sum, l) => sum + l.quantity_sent, 0))
}

export type LineState = 'waiting' | 'partial' | 'received' | 'short'

/** `short` only applies once the transfer is closed and fewer units arrived than were sent. */
export function lineState(line: Pick<TransferLineLike, 'quantity_sent' | 'quantity_received'>, status: TransferStatus): LineState {
  const missing = outstanding(line)
  if (missing === 0) return 'received'
  if (status === 'completed') return 'short'
  return line.quantity_received > 0 ? 'partial' : 'waiting'
}

/**
 * Which line a scanned code belongs to: barcode or QR value exactly, otherwise SKU case-insensitively.
 * Lines that still have units outstanding win over fully received ones with the same code.
 */
export function findLineByCode<T extends TransferLineLike>(lines: T[], code: string): T | null {
  const lower = code.toLowerCase()
  const matches = (l: T) => l.barcode === code || l.qr_code === code || l.sku?.toLowerCase() === lower
  const hits = lines.filter(matches)
  return hits.find((l) => outstanding(l) > 0) ?? hits[0] ?? null
}

// ----------------------------------------------------------------- dispatch draft

export interface DraftLine {
  productId: string
  name: string
  sku: string | null
  unit: string
  /** Quantity on hand in the source inventory when the item was added. */
  available: number
  quantity: number
}

export interface DraftProduct {
  id: string
  name: string
  sku: string | null
  unit: string
  quantity: number
  archived_at?: string | null
}

export type DraftResult = { ok: true; draft: DraftLine[] } | { ok: false; error: string }

/** Add `by` units of a product to the dispatch list (a repeat scan adds to the existing line). */
export function addToDraft(draft: DraftLine[], product: DraftProduct, by = 1): DraftResult {
  if (product.archived_at) return { ok: false, error: `${product.name} is archived and cannot be transferred.` }
  const existing = draft.find((l) => l.productId === product.id)
  const next = roundQty((existing?.quantity ?? 0) + by)
  if (product.quantity <= 0) return { ok: false, error: `${product.name} has no stock to transfer.` }
  if (next > product.quantity) {
    return { ok: false, error: `Only ${roundQty(product.quantity)} ${product.unit} of ${product.name} available.` }
  }
  if (existing) {
    return { ok: true, draft: draft.map((l) => (l.productId === product.id ? { ...l, quantity: next, available: product.quantity } : l)) }
  }
  return { ok: true, draft: [...draft, { productId: product.id, name: product.name, sku: product.sku, unit: product.unit, available: product.quantity, quantity: next }] }
}

export function setDraftQuantity(draft: DraftLine[], productId: string, quantity: number): DraftLine[] {
  const q = roundQty(quantity)
  return draft.flatMap((l) => (l.productId !== productId ? [l] : q <= 0 ? [] : [{ ...l, quantity: Math.min(q, l.available) }]))
}

/** Reasons the draft cannot be dispatched yet, or null when it is ready. */
export function draftProblem(draft: DraftLine[], destinationId: string | null): string | null {
  if (!destinationId) return 'Choose where the items are going.'
  if (draft.length === 0) return 'Scan or add at least one item.'
  const over = draft.find((l) => l.quantity > l.available)
  if (over) return `${over.name}: only ${over.available} ${over.unit} available.`
  if (draft.length > 200) return 'A transfer can contain at most 200 items.'
  return null
}

export function toDispatchLines(draft: DraftLine[]): { product_id: string; quantity: number }[] {
  return draft.map((l) => ({ product_id: l.productId, quantity: l.quantity }))
}
