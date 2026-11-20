import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Package, Plus, ScanLine, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { fetchCategoryStock, fetchSummary } from '@/features/products/api'
import { fetchMovementSummary, listMovements } from '@/features/stock/api'
import { MovementList } from '@/features/stock/MovementList'
import { listNotifications } from '@/features/notifications/api'
import { NotificationRow } from '@/features/notifications/NotificationsPage'
import { DemoDataPanel } from './DemoDataPanel'
import { countIncoming } from '@/features/transfers/api'
import { useWorkspace } from './WorkspaceProvider'

const CategoryChart = lazy(() => import('./DashboardCharts').then((m) => ({ default: m.CategoryChart })))
const FlowChart = lazy(() => import('./DashboardCharts').then((m) => ({ default: m.FlowChart })))

function Metric({ label, value, to, tone }: { label: string; value: number; to?: string; tone?: 'warn' | 'crit' }) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-fg-2">{label}</p>
      <p className={`num text-2xl font-semibold ${tone === 'crit' && value > 0 ? 'text-crit' : tone === 'warn' && value > 0 ? 'text-warn' : ''}`}>
        {value.toLocaleString()}
      </p>
    </>
  )
  return to ? (
    <Link to={to} className="block rounded-lg border border-line bg-bg-2 p-3 hover:bg-surface">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-bg-2 p-3">{body}</div>
  )
}

export function OverviewPage() {
  const { organization, role, inventory } = useWorkspace()
  const inventoryId = inventory?.id ?? ''
  const summary = useQuery({ queryKey: ['summary', inventoryId], queryFn: () => fetchSummary(inventoryId), enabled: Boolean(inventoryId) })
  const byCategory = useQuery({ queryKey: ['category-stock', inventoryId], queryFn: () => fetchCategoryStock(inventoryId), enabled: Boolean(inventoryId) })

  const alerts = useQuery({
    queryKey: ['notifications', organization.organizationId, inventoryId, 'dashboard'],
    queryFn: () => listNotifications({ organizationId: organization.organizationId, inventoryId, unreadOnly: true, page: 0, pageSize: 5 }),
    enabled: Boolean(inventoryId),
    retry: false,
  })
  const incomingCount = useQuery({ queryKey: ['transfers', 'incoming-count', inventoryId], queryFn: () => countIncoming(inventoryId), enabled: Boolean(inventoryId), retry: false })
  const flow = useQuery({ queryKey: ['movement-summary', inventoryId], queryFn: () => fetchMovementSummary(inventoryId, 14), enabled: Boolean(inventoryId) })
  const recent = useQuery({
    queryKey: ['movements', inventoryId, 'recent'],
    queryFn: () => listMovements({ inventoryId, type: 'all', page: 0, pageSize: 8 }),
    enabled: Boolean(inventoryId),
  })

  if (!inventory) {
    return (
      <>
        <PageHeader title="Dashboard" description={organization.organizationName} />
        <EmptyState
          title="Create your first inventory"
          description="An inventory holds the products you track."
          action={
            can(role, 'inventory.manage') ? (
              <Button asChild variant="primary">
                <Link to="/inventories">Create inventory</Link>
              </Button>
            ) : undefined
          }
        />
        <div className="mt-4 max-w-xl">
          <DemoDataPanel />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${organization.organizationName} · ${inventory.name}`}
      />
      {/* The everyday jobs, one tap away. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button asChild variant="primary" size="lg">
          <Link to="/scan">
            <ScanLine className="h-4 w-4" aria-hidden /> Scan item
          </Link>
        </Button>
        {can(role, 'product.write') && (
          <Button asChild size="lg">
            <Link to="/products?new=1">
              <Plus className="h-4 w-4" aria-hidden /> Add product
            </Link>
          </Button>
        )}
        <Button asChild size="lg">
          <Link to="/products">
            <Package className="h-4 w-4" aria-hidden /> Products
          </Link>
        </Button>
        {can(role, 'stock.write') && (
          <Button asChild size="lg">
            <Link to="/transfers/new">
              <Truck className="h-4 w-4" aria-hidden /> Send transfer
            </Link>
          </Button>
        )}
      </div>
      {summary.isPending && <LoadingState />}
      {summary.isError && <ErrorState message={errorMessage(summary.error)} onRetry={() => void summary.refetch()} />}
      {summary.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Metric label="Products" value={summary.data.total_products} to="/products" />
          <Metric label="Units in stock" value={summary.data.total_units} />
          <Metric label="Low stock" value={summary.data.low_stock} tone="warn" to="/products?state=low" />
          <Metric label="Out of stock" value={summary.data.out_of_stock} tone="crit" to="/products?state=out" />
          <Metric label="Expiring (30d)" value={summary.data.expiring} tone="warn" to="/products?expiry=expiring" />
          <Metric label="Expired" value={summary.data.expired} tone="crit" to="/products?expiry=expired" />
        </div>
      )}

      {incomingCount.data !== undefined && incomingCount.data > 0 && (
        <Link
          to="/transfers?direction=incoming"
          className="mt-4 flex items-center justify-between rounded-lg border border-warn bg-bg-2 px-4 py-3 hover:bg-surface"
        >
          <span>
            <b className="num">{incomingCount.data}</b> transfer{incomingCount.data === 1 ? ' is' : 's are'} on the way to {inventory.name}.
          </span>
          <span className="text-sm underline">Receive</span>
        </Link>
      )}

      {alerts.data && alerts.data.rows.length > 0 && (
        <Panel className="mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <h2 className="font-semibold">Needs attention</h2>
            <Link to="/notifications" className="text-sm underline">
              All alerts ({alerts.data.total} unread)
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {alerts.data.rows.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mt-4 p-4">
        <h2 className="mb-3 font-semibold">Units by category</h2>
        {byCategory.isPending && <LoadingState />}
        {byCategory.isError && <ErrorState message={errorMessage(byCategory.error)} />}
        {byCategory.data && byCategory.data.length === 0 && <p className="text-sm text-fg-2">No products yet.</p>}
        {byCategory.data && byCategory.data.length > 0 && (
          <Suspense fallback={<div className="h-64" aria-hidden />}>
            <CategoryChart data={byCategory.data} />
          </Suspense>
        )}
      </Panel>

      <Panel className="mt-4 p-4">
        <h2 className="mb-3 font-semibold">Stock movement, last 14 days</h2>
        {flow.isPending && <LoadingState />}
        {flow.isError && <ErrorState message={errorMessage(flow.error)} />}
        {flow.data && !flow.data.some((d) => d.units_in > 0 || d.units_out > 0) && <p className="text-sm text-fg-2">No movements in this period.</p>}
        {flow.data && flow.data.some((d) => d.units_in > 0 || d.units_out > 0) && (
          <Suspense fallback={<div className="h-56" aria-hidden />}>
            <FlowChart data={flow.data} />
          </Suspense>
        )}
      </Panel>

      <Panel className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <h2 className="font-semibold">Recent activity</h2>
          <Link to="/movements" className="text-sm underline">
            All movements
          </Link>
        </div>
        {recent.isPending && <LoadingState />}
        {recent.isError && <ErrorState message={errorMessage(recent.error)} />}
        {recent.data && recent.data.rows.length === 0 && <p className="p-4 text-sm text-fg-2">No stock movements yet.</p>}
        {recent.data && recent.data.rows.length > 0 && <MovementList rows={recent.data.rows} />}
      </Panel>
    </>
  )
}
