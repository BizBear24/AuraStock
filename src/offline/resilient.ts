import { classifyError } from '@/domain/sync'

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/**
 * Read from the server when reachable, otherwise from the on-device cache.
 * Only connectivity failures fall back; real errors (permissions, bad requests) still surface.
 */
export async function readThrough<T>(fromServer: () => Promise<T>, fromCache: () => Promise<T>): Promise<T> {
  if (!isOnline()) return fromCache()
  try {
    return await fromServer()
  } catch (e) {
    if (classifyError(e) === 'network') return fromCache()
    throw e
  }
}
