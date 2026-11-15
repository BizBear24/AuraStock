import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { ACTIVITY_CATEGORIES, describeActivity, type ActivityCategory } from '@/domain/team'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { ACTIVITY_PAGE_SIZE, listActivity, type ActivityEntry } from './api'

/** Where clicking an entry should lead, when there is somewhere sensible to go. */
function target(e: ActivityEntry): string | null {
  if (e.entity_type === 'product' && e.entity_id && !e.action.endsWith('delete')) return `/products/${e.entity_id}`
  if (e.entity_type === 'transfer' && e.entity_id) return `/transfers/${e.entity_id}`
  if (e.entity_type === 'inventory') return '/inventories'
  if (e.entity_type === 'member' || e.entity_type === 'invitation') return '/team'
  return null
}

export function ActivityPage() {
  const { organization, role } = useWorkspace()
  const [category, setCategory] = useState<ActivityCategory | null>(null)
  const [page, setPage] = useState(0)
  const allowed = can(role, 'org.manage')

  const query = useQuery({
    queryKey: ['activity', organization.organizationId, category, page],
    queryFn: () => listActivity({ organizationId: organization.organizationId, category, page }),
    enabled: allowed,
    placeholderData: (prev) => prev,
  })

  if (!allowed) {
    return (
      <>
        <PageHeader title="Activity" />
        <EmptyState title="Admins and owners only" description="The team activity log is visible to admins and owners. You can still see stock history on the Movements page." />
      </>
    )
  }

  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE))

  return (
    <>
      <PageHeader title="Activity" description={`${organization.organizationName} · who did what, newest first`} />
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
        {[{ id: null, label: 'Everything' }, ...ACTIVITY_CATEGORIES].map((c) => (
          <button
            key={c.id ?? 'all'}
            type="button"
            aria-pressed={category === c.id}
            onClick={() => {
              setCategory(c.id)
              setPage(0)
            }}
            className={`h-8 rounded-md border px-3 text-sm ${category === c.id ? 'border-fg bg-fg font-medium text-bg' : 'border-line bg-bg-2 hover:bg-surface'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Panel className="overflow-hidden">
        {query.isPending && <LoadingState label="Loading activity" />}
        {query.isError && <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
        {query.data && query.data.rows.length === 0 && (
          <div className="p-4">
            <EmptyState title="No activity yet" description="Changes made by your team will appear here." />
          </div>
        )}
        {query.data && query.data.rows.length > 0 && (
          <ul className="divide-y divide-line">
            {query.data.rows.map((e) => {
              const href = target(e)
              const text = describeActivity(e.action, e.details, e.inventory_name)
              return (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <p className="min-w-0 text-sm">
                    <b>{e.actor_name ?? 'System'}</b> ·{' '}
                    {href ? (
                      <Link to={href} className="hover:underline">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </p>
                  <p className="num shrink-0 text-xs text-fg-2">{new Date(e.created_at).toLocaleString()}</p>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {total > ACTIVITY_PAGE_SIZE && (
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
