import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Panel } from '@/components/ui/panel'
import { Switch } from '@/components/ui/switch'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { purgeInventoryCache } from '@/offline/local'
import { useOffline } from '@/offline/OfflineProvider'
import { removeDemoData, seedDemoData } from './api'
import { useWorkspace } from './WorkspaceProvider'

/**
 * Toggle that fills the workspace with a realistic sample inventory (products, stock history, alerts...)
 * so every screen can be explored, and removes it again. Only the flagged demo inventory is ever deleted.
 */
export function DemoDataPanel() {
  const { organization, role, inventories, inventory, setInventoryId } = useWorkspace()
  const { snapshot } = useOffline()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const demo = inventories.find((i) => i.is_demo)
  const allowed = can(role, 'inventory.manage')

  const refreshAll = () => queryClient.invalidateQueries()

  const load = useMutation({
    mutationFn: () => seedDemoData(organization.organizationId),
    onSuccess: async (id) => {
      await refreshAll()
      setInventoryId(id)
    },
  })
  const remove = useMutation({
    mutationFn: async () => {
      const id = demo?.id
      await removeDemoData(organization.organizationId)
      if (id) await purgeInventoryCache(id)
    },
    onSuccess: async () => {
      setConfirming(false)
      await refreshAll()
    },
  })

  const busy = load.isPending || remove.isPending
  const error = load.error ?? remove.error

  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Demo data</h2>
          <p className="mt-1 text-sm text-fg-2">
            {demo
              ? 'A sample inventory is loaded: about 38 products, 28 days of stock history, alerts, tags and categories. Switch it off to delete it.'
              : 'Fill this workspace with a realistic sample inventory (products, stock movements, low-stock, expiring and expired items, alerts) to explore every screen.'}
          </p>
        </div>
        <Switch
          label="Demo data"
          checked={Boolean(demo)}
          busy={busy}
          disabled={!allowed || !snapshot.online}
          onCheckedChange={(next) => (next ? load.mutate() : setConfirming(true))}
        />
      </div>
      {!allowed && <p className="mt-2 text-xs text-fg-2">Only admins and owners can change demo data.</p>}
      {allowed && !snapshot.online && <p className="mt-2 text-xs text-warn">Demo data needs a connection.</p>}
      {load.isPending && <p role="status" className="mt-2 text-sm text-fg-2">Loading sample data…</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-crit">
          {errorMessage(error)}
        </p>
      )}
      {demo && inventory?.id !== demo.id && (
        <button type="button" className="mt-2 text-sm underline" onClick={() => setInventoryId(demo.id)}>
          Switch to the demo inventory
        </button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove demo data?"
        description="The demo inventory and everything in it (its products, stock history and alerts) will be permanently deleted. Your real inventories are not affected."
        confirmLabel="Remove demo data"
        destructive
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() => remove.mutate()}
      />
    </Panel>
  )
}
