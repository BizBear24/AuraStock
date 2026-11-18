import { useSyncExternalStore } from 'react'
import type { AccessToken } from './gis'

/**
 * The current Google access token, kept in memory only: never written to storage, never sent to our
 * servers, and gone when the tab closes. It expires after about an hour; the user signs in again then.
 */
let current: (AccessToken & { email: string | null }) | null = null
const listeners = new Set<() => void>()

export const googleToken = {
  get(now: number = Date.now()): (AccessToken & { email: string | null }) | null {
    if (current && current.expiresAt <= now) current = null
    return current
  },
  set(token: AccessToken, email: string | null): void {
    current = { ...token, email }
    for (const l of listeners) l()
  },
  clear(): void {
    current = null
    for (const l of listeners) l()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useGoogleToken() {
  return useSyncExternalStore(googleToken.subscribe, () => googleToken.get())
}
