import { toDateString } from './product-status'

export const MOVEMENT_TYPES = ['in', 'out', 'adjustment', 'correction'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  in: 'Stock in',
  out: 'Stock out',
  adjustment: 'Adjustment',
  correction: 'Correction',
}

/**
 * Meaning of `amount` per type (mirrors record_stock_movement in the database):
 *  in / out    quantity to add / remove, > 0
 *  adjustment  counted quantity on hand, >= 0
 *  correction  signed, non-zero change
 */
export type MovementCheck = { ok: true; delta: number; after: number } | { ok: false; reason: string }

export interface MovementContext {
  current: number
  archived: boolean
  expiresOn: string | null
  note?: string | null
  today?: Date
}

/** Quantities have three decimal places in the database; avoid float drift such as 0.1 + 0.2. */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function formatQty(n: number): string {
  return String(roundQty(n))
}

/**
 * Client-side pre-check used for instant feedback. The database function is the authority and
 * re-validates everything under a row lock, so a stale `current` can never corrupt stock.
 */
export function evaluateMovement(type: MovementType, amount: number, ctx: MovementContext): MovementCheck {
  if (!Number.isFinite(amount)) return { ok: false, reason: 'Enter a number' }
  if (ctx.archived) return { ok: false, reason: 'Archived products cannot change stock. Restore the product first.' }
  const value = roundQty(amount)
  const hasNote = Boolean(ctx.note && ctx.note.trim())
  let delta: number

  switch (type) {
    case 'in':
      if (value <= 0) return { ok: false, reason: 'Quantity must be greater than zero' }
      if (ctx.expiresOn && ctx.expiresOn < toDateString(ctx.today ?? new Date())) {
        return { ok: false, reason: 'This product is expired. Update its expiration date before receiving stock.' }
      }
      delta = value
      break
    case 'out':
      if (value <= 0) return { ok: false, reason: 'Quantity must be greater than zero' }
      delta = -value
      break
    case 'adjustment':
      if (value < 0) return { ok: false, reason: 'Counted quantity cannot be negative' }
      if (!hasNote) return { ok: false, reason: 'A note is required for adjustments' }
      delta = roundQty(value - ctx.current)
      break
    case 'correction':
      if (value === 0) return { ok: false, reason: 'Correction amount cannot be zero' }
      if (!hasNote) return { ok: false, reason: 'A note is required for corrections' }
      delta = value
      break
  }

  if (delta === 0) return { ok: false, reason: 'No change: the counted quantity equals the current quantity' }
  const after = roundQty(ctx.current + delta)
  if (after < 0) {
    return { ok: false, reason: `Insufficient stock: ${formatQty(ctx.current)} available, ${formatQty(Math.abs(delta))} requested` }
  }
  return { ok: true, delta, after }
}
