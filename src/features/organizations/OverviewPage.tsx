import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { fetchCategoryStock, fetchSummary } from '@/features/products/api'
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
      <p className="mt-3 text-xs text-fg-2">Recent activity and movement summaries appear once stock operations ship in the next phase.</p>
    </>
  )
}
