import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge, type Status } from '@/components/ui/status-badge'
import { can } from '@/domain/permissions'
import { totalOutstanding, totalSent, TRANSFER_STATUS_LABEL, type TransferStatus } from '@/domain/transfer'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { listTransfers, TRANSFERS_PAGE_SIZE, type Direction, type Transfer } from './api'

export const STATUS_TONE: Record<TransferStatus, Status> = { in_transit: 'warn', completed: 'ok', cancelled: 'neutral' }

const TABS: { id: Direction; label: string }[] = [
  { id: 'incoming', label: 'Incoming' },
  { id: 'outgoing', label: 'Outgoing' },
  { id: 'all', label: 'All' },
]

function Progress({ t }: { t: Transfer }) {
  const sent = totalSent(t.lines)
  const waiting = totalOutstanding(t.lines)
  return (
    <span className="num text-sm">
      {sent - waiting} / {sent} <span className="text-fg-2">units arrived</span>
    </span>
  )
}

export function TransfersPage() {
  const { organization, inventory, role } = useWorkspace()
  const [params] = useSearchParams()
  const initial = params.get('direction')
  const [direction, setDirection] = useState<Direction>(initial === 'outgoing' || initial === 'all' ? initial : 'incoming')
  const [status, setStatus] = useState<'all' | TransferStatus>('all')
  const [page, setPage] = useState(0)
  const inventoryId = inventory?.id ?? ''

  const query = useQuery({
    queryKey: ['transfers', organization.organizationId, inventoryId, direction, status, page],
    queryFn: () => listTransfers({ organizationId: organization.organizationId, inventoryId, direction, status, page }),
    enabled: Boolean(inventoryId),
    placeholderData: (prev) => prev,
  })

  if (!inventory) return <EmptyState title="No inventory selected" description="Create an inventory first." />
  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / TRANSFERS_PAGE_SIZE))

  return (
    <>
      <PageHeader
        title="Transfers"
        description={`${inventory.name} · move stock between your inventories, scanned out and scanned in`}
        actions={
          can(role, 'stock.write') && (
            <Button asChild variant="primary">
              <Link to="/transfers/new">
                <Plus className="h-4 w-4" aria-hidden /> New transfer
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Direction" className="inline-flex overflow-hidden rounded-md border border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={direction === t.id}
              onClick={() => {
                setDirection(t.id)
                setPage(0)
              }}
              className={`h-9 px-4 text-sm ${direction === t.id ? 'bg-fg font-medium text-bg' : 'bg-bg-2 hover:bg-surface'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Status"
          className="h-9 rounded-md border border-line bg-bg-2 px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'all' | TransferStatus)
            setPage(0)
          }}
        >
          <option value="all">Any status</option>
          <option value="in_transit">In transit</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <Panel className="overflow-hidden">
        {query.isPending && <LoadingState label="Loading transfers" />}
        {query.isError && <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
        {query.data && query.data.rows.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="No transfers"
              description={direction === 'incoming' ? 'Nothing is on its way to this inventory.' : 'Dispatch items to another inventory to start a transfer.'}
            />
          </div>
        )}
        {query.data && query.data.rows.length > 0 && (
          <ul className="divide-y divide-line">
            {query.data.rows.map((t) => (
              <li key={t.id}>
                <Link to={`/transfers/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-surface">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 font-medium">
                      <span className="num">{t.reference}</span>
                      <span className="flex items-center gap-1 text-fg-2">
                        {t.source?.name ?? 'Unknown'} <ArrowRight className="h-3.5 w-3.5" aria-hidden /> {t.destination?.name ?? 'Unknown'}
                      </span>
                    </p>
                    <p className="num text-xs text-fg-2">
                      {new Date(t.dispatched_at).toLocaleString()} · {t.lines.length} item{t.lines.length === 1 ? '' : 's'}
                      {t.destination_inventory_id === inventoryId ? ' · incoming' : ' · outgoing'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress t={t} />
                    <StatusBadge status={STATUS_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</StatusBadge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {total > TRANSFERS_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="num text-fg-2">
            Page {page + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
