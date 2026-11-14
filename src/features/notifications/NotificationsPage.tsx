import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge, type Status } from '@/components/ui/status-badge'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { listNotifications, markRead, NOTIFICATIONS_PAGE_SIZE, type AlertKind, type AppNotification } from './api'

export const ALERT_LABEL: Record<AlertKind, { label: string; status: Status }> = {
  out_of_stock: { label: 'Out of stock', status: 'crit' },
  low_stock: { label: 'Low stock', status: 'warn' },
  expired: { label: 'Expired', status: 'crit' },
  expiring: { label: 'Expiring', status: 'warn' },
  transfer_incoming: { label: 'Incoming transfer', status: 'info' },
  transfer_discrepancy: { label: 'Transfer shortage', status: 'crit' },
}

export function NotificationRow({ n, onOpen }: { n: AppNotification; onOpen?: (n: AppNotification) => void }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span aria-label={n.is_read ? 'Read' : 'Unread'} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-info'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={ALERT_LABEL[n.kind].status}>{ALERT_LABEL[n.kind].label}</StatusBadge>
          <span className="num text-xs text-fg-2">{new Date(n.created_at).toLocaleString()}</span>
        </div>
        <p className={`mt-1 ${n.is_read ? '' : 'font-medium'}`}>
          {n.product_id || n.kind.startsWith('transfer_') ? (
            <Link
              to={n.product_id ? `/products/${n.product_id}` : n.kind === 'transfer_incoming' ? '/transfers?direction=incoming' : '/transfers?direction=all'}
              className="hover:underline"
              onClick={() => onOpen?.(n)}
            >
              {n.title}
            </Link>
          ) : (
            n.title
          )}
        </p>
        <p className="text-sm text-fg-2">{n.body}</p>
      </div>
    </li>
  )
}

export function NotificationsPage() {
  const { organization, inventory } = useWorkspace()
  const queryClient = useQueryClient()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [thisInventory, setThisInventory] = useState(false)
  const [page, setPage] = useState(0)
  const orgId = organization.organizationId
  const inventoryId = thisInventory ? inventory?.id : undefined

  const query = useQuery({
    queryKey: ['notifications', orgId, inventoryId ?? 'all', unreadOnly, page],
    queryFn: () => listNotifications({ organizationId: orgId, inventoryId, unreadOnly, page }),
    placeholderData: (prev) => prev,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  const markAll = useMutation({ mutationFn: () => markRead(orgId, null), onSuccess: refresh })
  const markOne = useMutation({ mutationFn: (id: string) => markRead(orgId, [id]), onSuccess: refresh })

  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE))

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Low stock, out of stock and expiry alerts for your organization. Alerts are stored, so you never miss one."
        actions={
          <Button loading={markAll.isPending} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(0) }} /> Unread only
        </label>
        {inventory && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={thisInventory} onChange={(e) => { setThisInventory(e.target.checked); setPage(0) }} /> Only {inventory.name}
          </label>
        )}
      </div>
      {(markAll.isError || markOne.isError) && (
        <p role="alert" className="mb-3 text-sm text-crit">
          {errorMessage(markAll.error ?? markOne.error)}
        </p>
      )}
      <Panel className="overflow-hidden">
        {query.isPending && <LoadingState label="Loading alerts" />}
        {query.isError && <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
        {query.data && query.data.rows.length === 0 && (
          <div className="p-4">
            <EmptyState title={unreadOnly ? 'No unread alerts' : 'No alerts yet'} description="Alerts appear when products run low, run out, or approach their expiration date." />
          </div>
        )}
        {query.data && query.data.rows.length > 0 && (
          <ul className="divide-y divide-line">
            {query.data.rows.map((n) => (
              <NotificationRow key={n.id} n={n} onOpen={(x) => !x.is_read && markOne.mutate(x.id)} />
            ))}
          </ul>
        )}
      </Panel>
      {total > NOTIFICATIONS_PAGE_SIZE && (
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
