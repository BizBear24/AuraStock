/**
 * Web NFC (NDEF). Available only in Chrome on Android, over HTTPS, after the user taps a button.
 * Everywhere else isNfcSupported() is false and the app offers barcodes and printable QR labels instead.
 * https://developer.mozilla.org/docs/Web/API/Web_NFC_API
 */
import { unwrapScanUrl } from '@/domain/scan'

export interface NdefRecordLike {
  recordType: string
  encoding?: string | null
  data?: DataView | null
}

interface NdefReadingEvent extends Event {
  serialNumber?: string
  message: { records: NdefRecordLike[] }
}

interface NdefReaderLike extends EventTarget {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>
  write: (message: { records: { recordType: string; data: string }[] }, options?: { signal?: AbortSignal; overwrite?: boolean }) => Promise<void>
}

type NdefReaderCtor = new () => NdefReaderLike

function readerCtor(win: Window = window): NdefReaderCtor | null {
  const ctor = (win as unknown as { NDEFReader?: NdefReaderCtor }).NDEFReader
  return typeof ctor === 'function' ? ctor : null
}

export function isNfcSupported(win: Window = window): boolean {
  return readerCtor(win) !== null && win.isSecureContext !== false
}

export const NFC_UNSUPPORTED_MESSAGE = 'NFC works in Chrome on Android over HTTPS. On this device, use barcodes or print a QR label instead.'

/** Text carried by a record: text records as-is, URL records with AuraStock scan links unwrapped to their code. */
export function recordToCode(record: NdefRecordLike): string | null {
  if (!record.data) return null
  const bytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)
  if (record.recordType === 'text') {
    const text = new TextDecoder(record.encoding || 'utf-8').decode(bytes).trim()
    return text || null
  }
  if (record.recordType === 'url' || record.recordType === 'absolute-url') {
    const url = new TextDecoder('utf-8').decode(bytes).trim()
    const code = unwrapScanUrl(url)
    return code !== url ? code : null
  }
  return null
}

export interface TagRead {
  /** Hardware serial number of the tag, when the browser exposes it. */
  serial: string | null
  /** Product codes written on the tag (from text records and AuraStock scan links). */
  codes: string[]
}

export function parseReading(event: { serialNumber?: string; message: { records: NdefRecordLike[] } }): TagRead {
  const codes = event.message.records.map(recordToCode).filter((c): c is string => Boolean(c))
  return { serial: event.serialNumber?.trim() || null, codes: [...new Set(codes)] }
}

export function nfcErrorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
  if (name === 'NotAllowedError') return 'NFC permission was denied. Allow NFC for this site in Chrome settings and try again.'
  if (name === 'NotSupportedError') return 'NFC is turned off or not available. Turn on NFC in the phone settings.'
  if (name === 'NotReadableError') return 'The tag could not be read. Hold it still against the back of the phone.'
  if (name === 'NetworkError') return 'The tag moved away before writing finished. Hold it still and try again.'
  if (name === 'AbortError') return 'Cancelled.'
  return error instanceof Error ? error.message : 'NFC failed.'
}

/** Wait for one tag to be tapped. Resolves with its serial number and codes; cancel with the signal. */
export function readNfcTag(signal: AbortSignal, win: Window = window): Promise<TagRead> {
  const Ctor = readerCtor(win)
  if (!Ctor) return Promise.reject(new Error(NFC_UNSUPPORTED_MESSAGE))
  const reader = new Ctor()
  return new Promise<TagRead>((resolve, reject) => {
    const onReading = (e: Event) => {
      cleanup()
      resolve(parseReading(e as NdefReadingEvent))
    }
    const onError = () => {
      cleanup()
      reject(Object.assign(new Error('The tag could not be read.'), { name: 'NotReadableError' }))
    }
    const onAbort = () => {
      cleanup()
      reject(Object.assign(new Error('Cancelled.'), { name: 'AbortError' }))
    }
    const cleanup = () => {
      reader.removeEventListener('reading', onReading)
      reader.removeEventListener('readingerror', onError)
      signal.removeEventListener('abort', onAbort)
    }
    reader.addEventListener('reading', onReading)
    reader.addEventListener('readingerror', onError)
    signal.addEventListener('abort', onAbort)
    reader.scan({ signal }).catch((e: unknown) => {
      cleanup()
      reject(e)
    })
  })
}

/**
 * Write a product to a tag: a link to the scan screen (so any phone opens AuraStock on tap) plus the plain
 * code as a text record (so the app can read it without the link).
 */
export async function writeNfcTag(code: string, url: string, signal: AbortSignal, win: Window = window): Promise<void> {
  const Ctor = readerCtor(win)
  if (!Ctor) throw new Error(NFC_UNSUPPORTED_MESSAGE)
  await new Ctor().write({ records: [{ recordType: 'url', data: url }, { recordType: 'text', data: code }] }, { signal, overwrite: true })
}
