import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { MOVEMENT_LABEL } from '@/domain/stock'
import { errorMessage } from '@/lib/supabase'
import type { OutboxEntry } from './db'
import { useOffline } from './OfflineProvider'
import { describePhase } from './SyncStatus'

function summary(e: OutboxEntry): string {
  if (e.kind === 'stock_movement') {
    const sign = e.payload.localDelta > 0 ? '+' : ''
    return `${MOVEMENT_LABEL[e.payload.type]} · ${e.payload.productName} (${sign}${e.payload.localDelta})`
  }
  return `${e.payload.mode === 'create' ? 'New product' : 'Edit product'} · ${e.payload.productName}`
}

function statusBadge(e: OutboxEntry) {
  if (e.status === 'failed') return <StatusBadge status="crit">Rejected</StatusBadge>
  if (e.status === 'conflict') return <StatusBadge status="warn">Conflict</StatusBadge>
  if (e.status === 'syncing') return <StatusBadge status="info">Sending</StatusBadge>
  return <StatusBadge status="neutral">Saved on device</StatusBadge>
}

export function SyncPage() {
  const { engine, snapshot } = useOffline()
  const queryClient = useQueryClient()
  const [discarding, setDiscarding] = useState<OutboxEntry | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const d = describePhase(snapshot)

  const queue = useQuery({
    // Re-read whenever the engine's counts or phase change.
    queryKey: ['sync-queue', snapshot.pending, snapshot.failed, snapshot.conflicts, snapshot.phase],
    queryFn: () => engine.list(),
  })

  const run = async (work: () => Promise<void>) => {
    setActionError(null)
    try {
      await work()
      await queryClient.invalidateQueries({ queryKey: ['sync-queue'] })
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Sync"
        description={`${d.label}. ${d.detail}.`}
        actions={
          <Button variant="primary" disabled={!snapshot.online || snapshot.pending === 0} loading={snapshot.phase === 'syncing'} onClick={() => void run(() => engine.syncNow())}>
            Sync now
          </Button>
        }
      />
      {actionError && <p role="alert" className="mb-3 text-sm text-crit">{actionError}</p>}
      {snapshot.lastError && snapshot.phase !== 'synced' && <p className="mb-3 text-xs text-fg-2">Last error: {snapshot.lastError}</p>}
      <Panel className="overflow-hidden">
        {queue.isPending && <LoadingState />}
        {queue.isError && <ErrorState message={errorMessage(queue.error)} />}
        {queue.data && queue.data.length === 0 && (
          <div className="p-4">
            <EmptyState title="Nothing waiting" description="Every change you made has been confirmed by the server." />
          </div>
        )}
        {queue.data && queue.data.length > 0 && (
          <ul className="divide-y divide-line">
            {queue.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{summary(e)}</p>
                  <p className="num text-xs text-fg-2">
                    Queued {new Date(e.createdAt).toLocaleString()} · {e.attempts} attempt{e.attempts === 1 ? '' : 's'}
                  </p>
                  {e.lastError && <p className="mt-1 text-sm text-crit">{e.lastError}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(e)}
                  {e.status === 'failed' && <Button size="sm" onClick={() => void run(() => engine.retry(e.id))}>Retry</Button>}
                  {e.status === 'conflict' && (
                    <>
                      <Button size="sm" variant="primary" onClick={() => void run(() => engine.resolveConflict(e.id, 'mine'))}>
                        Keep my changes
                      </Button>
                      <Button size="sm" onClick={() => void run(() => engine.resolveConflict(e.id, 'theirs'))}>
                        Use server version
                      </Button>
                    </>
                  )}
                  {e.status !== 'conflict' && (
                    <Button size="sm" variant="ghost" onClick={() => setDiscarding(e)}>
                      Discard
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(o) => !o && setDiscarding(null)}
        title="Discard this change?"
        description={discarding ? `"${summary(discarding)}" will never be sent to the server. This cannot be undone.` : ''}
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          const id = discarding?.id
          setDiscarding(null)
          if (id) void run(() => engine.discard(id))
        }}
      />
    </>
  )
}
