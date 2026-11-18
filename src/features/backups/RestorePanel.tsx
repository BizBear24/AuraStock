import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { BackupDocument, InventorySummary } from '@/domain/backup'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { restoreBackup, type RestoreResult } from './api'

/**
 * Preview and restore a validated backup. Restoring creates NEW inventories next to the existing ones and
 * never changes or deletes current data, so it is always safe to try.
 */
export function RestorePanel({ document, inventories, onClose }: { document: BackupDocument; inventories: InventorySummary[]; onClose: () => void }) {
  const { organization, setInventoryId } = useWorkspace()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(() => new Set(inventories.filter((i) => !i.isDemo).map((i) => i.id)))
  const [result, setResult] = useState<RestoreResult | null>(null)

  const restore = useMutation({
    mutationFn: () => restoreBackup(organization.organizationId, document, [...selected]),
    onSuccess: async (r) => {
      setResult(r)
      await queryClient.invalidateQueries()
    },
  })

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (result) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-sm">
          Restored <b>{result.products}</b> products and <b>{result.movements}</b> stock movements into {result.inventories.length} new inventor{result.inventories.length === 1 ? 'y' : 'ies'}:
        </p>
        <ul className="space-y-1 text-sm">
          {result.inventories.map((i) => (
            <li key={i.new_id} className="flex items-center justify-between gap-2">
              <span>{i.name}</span>
              <Button size="sm" onClick={() => setInventoryId(i.new_id)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
        <Button onClick={onClose}>Done</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-2">
        Backup of <b className="text-fg">{document.organization.name}</b> from {new Date(document.created_at).toLocaleString()}. The file was checked and its stock history is consistent.
      </p>
      <p className="text-sm text-fg-2">
        Each chosen inventory is restored as a <b className="text-fg">new copy</b> named “… (restored date)”, with its products, categories, tags and full stock history. Nothing you have now is changed or deleted.
      </p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {inventories.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                {i.name}
                {i.isDemo && <span className="text-xs text-fg-2">(demo)</span>}
              </span>
              <span className="num text-xs text-fg-2">
                {i.products} products · {i.movements} movements
              </span>
            </label>
          </li>
        ))}
      </ul>
      {restore.isError && (
        <p role="alert" className="rounded-md border border-crit px-3 py-2 text-sm text-crit">
          {errorMessage(restore.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={restore.isPending} disabled={selected.size === 0} onClick={() => restore.mutate()}>
          Restore {selected.size} inventor{selected.size === 1 ? 'y' : 'ies'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}
