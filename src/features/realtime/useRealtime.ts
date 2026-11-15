import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import * as remote from '@/features/products/remote'
import { bestEffort, pullInventory } from '@/offline/local'

/** Which cached screens to refresh when a row in a table changes. Query keys are matched by their first element. */
export const TABLE_QUERY_KEYS = {
  products: ['products', 'product', 'summary', 'category-stock', 'notifications'],
  stock_movements: ['movements', 'movement-summary', 'products', 'product', 'summary', 'category-stock', 'activity'],
  notifications: ['notifications'],
  transfers: ['transfers', 'transfer', 'products', 'product', 'summary', 'activity'],
  organization_members: ['members', 'memberships', 'activity'],
  invitations: ['invitations', 'my-invitations'],
  inventories: ['inventories', 'memberships'],
} as const

export type RealtimeTable = keyof typeof TABLE_QUERY_KEYS

export function keysForTable(table: string): readonly string[] {
  return (TABLE_QUERY_KEYS as Record<string, readonly string[]>)[table] ?? []
}

/**
 * Collects table-change events and invalidates the affected queries once per burst, so a bulk import that
 * touches hundreds of rows causes one refresh instead of hundreds.
 */
export function createInvalidator(queryClient: Pick<QueryClient, 'invalidateQueries'>, delayMs = 500) {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    push(table: string): void {
      for (const key of keysForTable(table)) pending.add(key)
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        const keys = [...pending]
        pending.clear()
        void queryClient.invalidateQueries({ predicate: (q) => keys.includes(String(q.queryKey[0])) })
      }, delayMs)
    },
    cancel(): void {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pending.clear()
    },
  }
}

export type LiveStatus = 'connecting' | 'live' | 'offline'

/**
 * Live updates: subscribes to Postgres changes for the active organization and inventory. Row-level security
 * still applies, so a user only ever receives rows they may read. Changes made by teammates refresh the
 * screens (and the on-device copy of the inventory) within about a second.
 */
export function useRealtime(organizationId: string | undefined, inventoryId: string | undefined): LiveStatus {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')

  useEffect(() => {
    if (!organizationId) return
    const invalidator = createInvalidator(queryClient)
    let pullTimer: ReturnType<typeof setTimeout> | undefined

    const changed = (table: RealtimeTable) => {
      invalidator.push(table)
      // Keep the offline copy current too (debounced; incremental by updated_at).
      if (inventoryId && (table === 'products' || table === 'stock_movements')) {
        clearTimeout(pullTimer)
        pullTimer = setTimeout(() => bestEffort(pullInventory(inventoryId, remote), 'refresh inventory cache after live change'), 1500)
      }
    }

    const channel = supabase.channel(`aurastock:${organizationId}:${inventoryId ?? 'none'}`)
    const watch = (table: RealtimeTable, column: 'organization_id' | 'inventory_id', value: string) =>
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `${column}=eq.${value}` }, () => changed(table))

    watch('notifications', 'organization_id', organizationId)
    watch('transfers', 'organization_id', organizationId)
    watch('organization_members', 'organization_id', organizationId)
    watch('invitations', 'organization_id', organizationId)
    watch('inventories', 'organization_id', organizationId)
    if (inventoryId) {
      watch('products', 'inventory_id', inventoryId)
      watch('stock_movements', 'inventory_id', inventoryId)
    }

    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED') setStatus('live')
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('offline')
    })

    return () => {
      invalidator.cancel()
      clearTimeout(pullTimer)
      void supabase.removeChannel(channel)
    }
  }, [organizationId, inventoryId, queryClient])

  return status
}
