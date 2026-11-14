import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { OfflineClient } from './client'
import { openOfflineDb } from './db'
import { SyncEngine, type SyncSnapshot } from './engine'
import { executeEntry, refreshProduct } from './executors'
import { discardLocalEffects } from './local'
import { isOnline } from './resilient'

interface OfflineContextValue {
  engine: SyncEngine
  client: OfflineClient
  snapshot: SyncSnapshot
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

function createRuntime(userId: string) {
  const db = openOfflineDb(userId)
  const engine = new SyncEngine({
    db,
    execute: executeEntry,
    isOnline,
    afterDiscard: async (entry) => {
      await discardLocalEffects(entry)
      if (entry.kind === 'product_save' && entry.payload.mode === 'update') await refreshProduct(entry.productId)
    },
  })
  return { engine, client: new OfflineClient(engine, userId) }
}

const QUERY_PREFIXES = ['products', 'product', 'summary', 'category-stock', 'movements', 'movement-summary', 'categories', 'tags', 'notifications']

/** Opens the signed-in user's on-device database and runs the sync engine for the lifetime of the session. */
export function OfflineProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [runtime] = useState(() => createRuntime(userId))
  const { engine, client } = runtime
  const queryClient = useQueryClient()
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = async () => {
      const at = await engine.nextWakeAt()
      if (cancelled || at === null) return
      clearTimeout(timer)
      timer = setTimeout(() => void engine.flush().then(schedule), Math.max(1000, at - Date.now()))
    }
    const sync = () => engine.syncNow().then(schedule)
    const onOnline = () => void sync()
    const onOffline = () => void engine.refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }

    void engine.init().then(() => {
      if (!cancelled) return sync()
    })
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    const unsubscribe = engine.subscribe(() => void schedule())
    return () => {
      cancelled = true
      clearTimeout(timer)
      unsubscribe()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [engine])

  // Whenever the server confirms something, refresh what the screens are showing.
  const syncedAt = snapshot.lastSyncedAt
  useEffect(() => {
    if (syncedAt === null) return
    void queryClient.invalidateQueries({ predicate: (q) => QUERY_PREFIXES.includes(String(q.queryKey[0])) })
  }, [syncedAt, queryClient])

  const value = useMemo(() => ({ engine, client, snapshot }), [engine, client, snapshot])
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext)
  if (!ctx) throw new Error('useOffline must be used inside OfflineProvider')
  return ctx
}
