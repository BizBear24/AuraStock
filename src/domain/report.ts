import { expiryState, type StockState } from './product-status'

export interface ReportProduct {
  name: string
  category: { name: string } | null
  quantity: number
  min_stock: number
  stock_state: StockState
  expires_on: string | null
  archived_at: string | null
}

export interface StockSummary {
  products: number
  units: number
  low: number
  out: number
  expiring: number
  expired: number
}

/** Active (non-archived) products only. Mirrors the dashboard figures from `inventory_summary`. */
export function summarizeProducts(products: ReportProduct[], today: Date = new Date()): StockSummary {
  const active = products.filter((p) => p.archived_at === null)
  return {
    products: active.length,
    units: active.reduce((s, p) => s + p.quantity, 0),
    low: active.filter((p) => p.stock_state === 'low').length,
    out: active.filter((p) => p.stock_state === 'out').length,
    expiring: active.filter((p) => expiryState(p.expires_on, today) === 'expiring').length,
    expired: active.filter((p) => expiryState(p.expires_on, today) === 'expired').length,
  }
}

export interface CategoryTotal {
  category: string
  products: number
  units: number
}

export function totalsByCategory(products: ReportProduct[]): CategoryTotal[] {
  const groups = new Map<string, CategoryTotal>()
  for (const p of products) {
    if (p.archived_at !== null) continue
    const key = p.category?.name ?? 'Uncategorized'
    const g = groups.get(key) ?? { category: key, products: 0, units: 0 }
    g.products += 1
    g.units += p.quantity
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.units - a.units || a.category.localeCompare(b.category))
}

/** Products that need action: out of stock, low, expired or expiring. Worst first. */
export function attentionList<T extends ReportProduct>(products: T[], today: Date = new Date()): T[] {
  const rank = (p: T): number => {
    const expiry = expiryState(p.expires_on, today)
    if (expiry === 'expired') return 0
    if (p.stock_state === 'out') return 1
    if (expiry === 'expiring') return 2
    if (p.stock_state === 'low') return 3
    return 9
  }
  return products
    .filter((p) => p.archived_at === null && rank(p) < 9)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

const REPLACEMENTS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  '…': '...',
  ' ': ' ',
}

/**
 * The built-in PDF fonts only cover Latin-1. Map common typographic characters to ASCII and replace anything
 * else outside Latin-1 with "?" so text never renders as garbage.
 */
export function pdfText(value: string): string {
  let out = ''
  for (const ch of value) {
    const mapped = REPLACEMENTS[ch]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    const printable = code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff)
    out += printable ? ch : '?'
  }
  return out
}
