import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bar, BarChart, Legend, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { fetchCategoryStock, fetchSummary } from '@/features/products/api'
import { fetchMovementSummary, listMovements } from '@/features/stock/api'
import { MovementList } from '@/features/stock/MovementList'
import { useWorkspace } from './WorkspaceProvider'

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
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${organization.organizationName} · ${inventory.name}`}
        actions={
          <Button asChild>
            <Link to="/products">View products</Link>
          </Button>
        }
      />
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

      <Panel className="mt-4 p-4">
        <h2 className="mb-3 font-semibold">Units by category</h2>
        {byCategory.isPending && <LoadingState />}
        {byCategory.isError && <ErrorState message={errorMessage(byCategory.error)} />}
        {byCategory.data && byCategory.data.length === 0 && <p className="text-sm text-fg-2">No products yet.</p>}
        {byCategory.data && byCategory.data.length > 0 && (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory.data} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="category" tick={{ fill: 'var(--fg-2)', fontSize: 12 }} stroke="var(--border)" />
                <YAxis tick={{ fill: 'var(--fg-2)', fontSize: 12 }} stroke="var(--border)" />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6 }}
                  cursor={{ fill: 'var(--surface)' }}
                />
                <Bar dataKey="units" name="Units" fill="var(--fg-2)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel className="mt-4 p-4">
        <h2 className="mb-3 font-semibold">Stock movement, last 14 days</h2>
        {flow.isPending && <LoadingState />}
        {flow.isError && <ErrorState message={errorMessage(flow.error)} />}
        {flow.data && !flow.data.some((d) => d.units_in > 0 || d.units_out > 0) && <p className="text-sm text-fg-2">No movements in this period.</p>}
        {flow.data && flow.data.some((d) => d.units_in > 0 || d.units_out > 0) && (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flow.data} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: 'var(--fg-2)', fontSize: 12 }} stroke="var(--border)" />
                <YAxis tick={{ fill: 'var(--fg-2)', fontSize: 12 }} stroke="var(--border)" />
                <Tooltip contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6 }} cursor={{ fill: 'var(--surface)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="units_in" name="In" fill="var(--ok)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="units_out" name="Out" fill="var(--fg-2)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
