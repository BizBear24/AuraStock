import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import * as remote from '@/features/products/remote'
import { bestEffort, pullInventory } from './local'
import { useOffline } from './OfflineProvider'

/** Keep the on-device copy of the active inventory current while online. */
export function useInventoryCache(inventoryId: string | undefined): void {
  const { snapshot } = useOffline()
  const queryClient = useQueryClient()
  const online = snapshot.online
  const syncedAt = snapshot.lastSyncedAt

  useEffect(() => {
    if (!inventoryId || !online) return
    bestEffort(
      pullInventory(inventoryId, remote).then(() => queryClient.invalidateQueries({ queryKey: ['categories', inventoryId] })),
      'refresh inventory cache',
    )
  }, [inventoryId, online, syncedAt, queryClient])
}
