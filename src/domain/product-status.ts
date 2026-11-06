export type StockState = 'out' | 'low' | 'ok'
export type ExpiryState = 'none' | 'expired' | 'expiring' | 'ok'

export const DEFAULT_EXPIRY_WINDOW_DAYS = 30

/** Mirrors the generated `stock_state` column in the products table. */
export function stockState(quantity: number, minStock: number): StockState {
  if (quantity <= 0) return 'out'
  if (quantity <= minStock) return 'low'
  return 'ok'
}

/** Format a Date as a local calendar day (YYYY-MM-DD), matching Postgres `date` values. */
export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** ISO date strings compare correctly as plain strings. */
export function expiryState(
  expiresOn: string | null,
  today: Date = new Date(),
  windowDays: number = DEFAULT_EXPIRY_WINDOW_DAYS,
): ExpiryState {
  if (!expiresOn) return 'none'
  const todayStr = toDateString(today)
  if (expiresOn < todayStr) return 'expired'
  if (expiresOn <= toDateString(addDays(today, windowDays))) return 'expiring'
  return 'ok'
}

/**
 * Make free text safe for use inside a PostgREST `or=(...)` filter by removing
 * characters that have grammar meaning there, and LIKE wildcards.
 */
export function sanitizeSearch(input: string): string {
  return input.replace(/[,()%*_\\"]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Parse a comma-separated list into unique, trimmed, case-insensitively de-duplicated names. */
export function parseNameList(input: string, maxLength = 40): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(',')) {
    const name = raw.trim().slice(0, maxLength)
    const key = name.toLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out
}
