import { roundQty } from './stock'

export type ErrorClass = 'network' | 'auth' | 'transient' | 'permanent'

export const MAX_ATTEMPTS = 8

function field(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error ? (error as Record<string, unknown>)[key] : undefined
}

/**
 * How the sync engine should treat a failed request:
 *  network    no connectivity or timeout: keep the operation, try again when online
 *  auth       session expired: pause until the user signs in again
 *  transient  server hiccup (5xx, deadlock, serialization failure): retry with backoff
 *  permanent  rejected by validation, permissions or business rules: needs a person to look at it
 */
export function classifyError(error: unknown): ErrorClass {
  const message = String(field(error, 'message') ?? error ?? '')
  const code = String(field(error, 'code') ?? '')
  const statusValue = field(error, 'status')
  const status = typeof statusValue === 'number' ? statusValue : undefined

  if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt (is )?(expired|invalid)|invalid jwt/i.test(message)) return 'auth'
  if (error instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|offline/i.test(message)) {
    return 'network'
  }
  if ((status !== undefined && status >= 500) || ['40001', '40P01', '57014', '53300'].includes(code) || code.startsWith('08')) return 'transient'
  return 'permanent'
}

/** Exponential backoff with jitter: ~2s, 4s, 8s ... capped at 5 minutes. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(300_000, 2000 * 2 ** Math.max(0, attempts - 1))
  return Math.round(base * (0.5 + random() * 0.5))
}

/**
 * Quantity shown while operations are queued: the last server-confirmed quantity plus the effect of
 * queued movements. This is an estimate for display and offline pre-checks only; the server recomputes
 * from the authoritative ledger when each movement syncs.
 */
export function projectQuantity(serverQuantity: number, pendingDeltas: readonly number[]): number {
  const total = pendingDeltas.reduce((sum, d) => sum + d, serverQuantity)
  return Math.max(0, roundQty(total))
}
