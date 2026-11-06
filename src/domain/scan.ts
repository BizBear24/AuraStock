export const MAX_CODE_LENGTH = 512

export type ScanSource = 'camera' | 'scanner' | 'manual'

export type NormalizedScan = { ok: true; code: string } | { ok: false; reason: string }

/** Validate and clean a raw scan: strip control characters and whitespace, bound the length. */
export function normalizeScan(raw: string): NormalizedScan {
  // eslint-disable-next-line no-control-regex
  const code = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (code === '') return { ok: false, reason: 'Empty scan' }
  if (code.length > MAX_CODE_LENGTH) return { ok: false, reason: 'Scanned code is too long to be a product code' }
  return { ok: true, code }
}

/** Ignores the same code arriving again within a cooldown (cameras decode the same frame repeatedly). */
export class ScanDeduper {
  private lastCode: string | null = null
  private lastAt = 0
  private readonly cooldownMs: number

  constructor(cooldownMs = 1500) {
    this.cooldownMs = cooldownMs
  }

  accept(code: string, now: number): boolean {
    if (code === this.lastCode && now - this.lastAt < this.cooldownMs) return false
    this.lastCode = code
    this.lastAt = now
    return true
  }

  reset(): void {
    this.lastCode = null
    this.lastAt = 0
  }
}

/**
 * Detects HID ("keyboard wedge") barcode scanners: they type a code very quickly and finish with Enter.
 * Human typing is slower than `maxGapMs` between keys, so it never produces a scan.
 */
export class HidScannerBuffer {
  private buffer = ''
  private lastAt = 0
  private readonly maxGapMs: number
  private readonly minLength: number

  constructor(maxGapMs = 50, minLength = 4) {
    this.maxGapMs = maxGapMs
    this.minLength = minLength
  }

  /** Feed one key press; returns a completed code on Enter, otherwise null. */
  push(key: string, now: number): string | null {
    if (key === 'Enter') {
      const code = this.buffer
      this.buffer = ''
      return code.length >= this.minLength ? code : null
    }
    if (key.length !== 1) return null // Shift, Tab, arrows, etc.
    if (this.buffer !== '' && now - this.lastAt > this.maxGapMs) this.buffer = ''
    this.buffer += key
    this.lastAt = now
    return null
  }

  reset(): void {
    this.buffer = ''
  }
}

export type CameraFailure = 'permission-denied' | 'no-camera' | 'in-use' | 'unsupported' | 'unknown'

export function classifyCameraError(error: unknown): CameraFailure {
  const name = error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error) ? String((error as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'permission-denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-camera'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'in-use'
  if (name === 'TypeError') return 'unsupported'
  return 'unknown'
}

export const CAMERA_MESSAGE: Record<CameraFailure, string> = {
  'permission-denied': 'Camera access was blocked. Allow camera permission for this site in your browser settings, then try again.',
  'no-camera': 'No camera was found on this device. Use a USB scanner or enter the code manually.',
  'in-use': 'The camera is in use by another app or tab. Close it and try again.',
  unsupported: 'Camera scanning needs a secure (HTTPS) connection and a supported browser.',
  unknown: 'The camera could not be started. Use a USB scanner or enter the code manually.',
}

/** Escape LIKE/ILIKE wildcards so a scanned code is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
