import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { MOVEMENT_LABEL, MOVEMENT_TYPES } from '@/domain/stock'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { listMovements, MOVEMENTS_PAGE_SIZE, type MovementFilters } from './api'
import { MovementList } from './MovementList'

export function MovementsPage() {
  const { inventory } = useWorkspace()
  const [type, setType] = useState<MovementFilters['type']>('all')
  const [page, setPage] = useState(0)
  const inventoryId = inventory?.id ?? ''

  const query = useQuery({
    queryKey: ['movements', inventoryId, 'all', type, page],
    queryFn: () => listMovements({ inventoryId, type, page }),
    enabled: Boolean(inventoryId),
    placeholderData: (prev) => prev,
  })

  if (!inventory) return <EmptyState title="No inventory selected" description="Create an inventory first." />

  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / MOVEMENTS_PAGE_SIZE))

  return (
    <>
      <PageHeader title="Movements" description={`${inventory.name} · ${total} recorded. Movements are permanent and cannot be edited.`} />
      <div className="mb-3">
        <select
          aria-label="Movement type"
          className="h-9 rounded-md border border-line bg-bg-2 px-2 text-sm"
          value={type}
          onChange={(e) => {
            setType(e.target.value as MovementFilters['type'])
            setPage(0)
          }}
        >
          <option value="all">All types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <Panel className="overflow-hidden">
        {query.isPending && <LoadingState label="Loading movements" />}
        {query.isError && <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
        {query.data && query.data.rows.length === 0 && (
          <div className="p-4">
            <EmptyState title="No movements" description="Stock changes appear here once recorded from a product page." />
          </div>
        )}
        {query.data && query.data.rows.length > 0 && <MovementList rows={query.data.rows} />}
      </Panel>
      {total > MOVEMENTS_PAGE_SIZE && (
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
