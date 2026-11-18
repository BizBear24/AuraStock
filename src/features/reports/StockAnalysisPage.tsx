import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge, type Status } from '@/components/ui/status-badge'
import { analyseStock, analysisTable, summariseAnalysis, VELOCITY_LABEL, type AnalysisInput, type AnalysisRow, type Velocity } from '@/domain/analysis'
import { errorMessage, supabase } from '@/lib/supabase'
import { downloadBlob, fileStem, toXlsx } from '@/features/data/files'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { buildPdf } from './pdf'

async function fetchStockAnalysis(inventoryId: string, days: number): Promise<AnalysisInput[]> {
  const { data, error } = await supabase.rpc('stock_analysis', { inv: inventoryId, p_days: days })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_id: String(r.product_id),
    name: String(r.name),
    sku: (r.sku as string | null) ?? null,
    unit: String(r.unit),
    category: (r.category as string | null) ?? null,
    quantity: Number(r.quantity),
    min_stock: Number(r.min_stock),
    units_out: Number(r.units_out),
    units_in: Number(r.units_in),
    movements: Number(r.movements),
    last_movement_at: (r.last_movement_at as string | null) ?? null,
    expires_on: (r.expires_on as string | null) ?? null,
  }))
}

type Filter = 'all' | 'risk' | 'reorder' | 'fast' | 'slow' | 'dead'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'risk', label: 'At risk' },
  { id: 'reorder', label: 'To reorder' },
  { id: 'fast', label: 'Fast movers' },
  { id: 'slow', label: 'Slow movers' },
  { id: 'dead', label: 'No movement' },
]
const VELOCITY_TONE: Record<Velocity, Status> = { fast: 'info', normal: 'neutral', slow: 'warn', dead: 'crit' }

function matches(r: AnalysisRow, f: Filter): boolean {
  if (f === 'risk') return r.atRisk
  if (f === 'reorder') return r.reorderQty > 0
  if (f === 'fast' || f === 'slow' || f === 'dead') return r.velocity === f
  return true
}

/** Usage-based view of the inventory: what sells, what sits, what to reorder. */
export function StockAnalysisPage() {
  const { organization, inventory } = useWorkspace()
  const [days, setDays] = useState(30)
  const [filter, setFilter] = useState<Filter>('all')
  const inventoryId = inventory?.id ?? ''

  const query = useQuery({
    queryKey: ['stock-analysis', inventoryId, days],
    queryFn: () => fetchStockAnalysis(inventoryId, days),
    enabled: Boolean(inventoryId),
  })
  const rows = useMemo(() => (query.data ? analyseStock(query.data, { days }) : []), [query.data, days])
  const summary = summariseAnalysis(rows)
  const shown = rows.filter((r) => matches(r, filter)).sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || b.units_out - a.units_out || a.name.localeCompare(b.name))

  const exportFile = useMutation({
    mutationFn: async (format: 'xlsx' | 'pdf') => {
      const table = analysisTable(shown, days)
      const stem = `${fileStem(inventory!.name)}-stock-analysis-${new Date().toISOString().slice(0, 10)}`
      if (format === 'xlsx') {
        downloadBlob(await toXlsx(table, 'Stock analysis'), `${stem}.xlsx`)
      } else {
        const blob = await buildPdf({
          title: 'Stock analysis',
          subtitle: `${organization.organizationName} - ${inventory!.name} - last ${days} days, reorder horizon 14 days`,
          generatedAt: new Date(),
          landscape: true,
          summary: [
            ['Products', String(summary.products)],
            ['At risk', String(summary.atRisk)],
            ['To reorder', String(summary.toReorder)],
            ['No movement', String(summary.dead)],
            [`Units out`, String(summary.unitsOut)],
          ],
          sections: [{ heading: FILTERS.find((f) => f.id === filter)!.label, table, emptyText: 'No products match.' }],
        })
        downloadBlob(blob, `${stem}.pdf`)
      }
    },
  })

  if (!inventory) return <EmptyState title="No inventory selected" description="Create an inventory first." />

  return (
    <>
      <Link to="/reports" className="mb-2 inline-flex items-center gap-1 text-sm text-fg-2 hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Reports
      </Link>
      <PageHeader
        title="Stock analysis"
        description={`${inventory.name} · usage, days of cover and reorder suggestions (14-day horizon)`}
        actions={
          <>
            <Button size="sm" loading={exportFile.isPending && exportFile.variables === 'xlsx'} disabled={!query.data} onClick={() => exportFile.mutate('xlsx')}>
              <Download className="h-4 w-4" aria-hidden /> Excel
            </Button>
            <Button size="sm" loading={exportFile.isPending && exportFile.variables === 'pdf'} disabled={!query.data} onClick={() => exportFile.mutate('pdf')}>
              <Download className="h-4 w-4" aria-hidden /> PDF
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Period" className="h-9 rounded-md border border-line bg-bg-2 px-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`h-8 rounded-md border px-3 text-sm ${filter === f.id ? 'border-fg bg-fg font-medium text-bg' : 'border-line bg-bg-2 hover:bg-surface'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {query.data && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ['Products', summary.products],
            ['At risk', summary.atRisk],
            ['To reorder', summary.toReorder],
            ['Fast movers', summary.fast],
            ['No movement', summary.dead],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-bg-2 p-3">
              <p className="text-xs uppercase tracking-wide text-fg-2">{label}</p>
              <p className="num text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      {exportFile.isError && <p role="alert" className="mb-3 text-sm text-crit">{errorMessage(exportFile.error)}</p>}

      <Panel className="overflow-hidden">
        {query.isPending && <LoadingState label="Analysing stock" />}
        {query.isError && <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
        {query.data && shown.length === 0 && (
          <div className="p-4">
            <EmptyState title="No products match" description="Try another filter or a longer period." />
          </div>
        )}
        {shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-fg-2">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">On hand</th>
                  <th className="px-3 py-2 text-right">Out ({days} d)</th>
                  <th className="px-3 py-2 text-right">Per day</th>
                  <th className="px-3 py-2 text-right">Days of cover</th>
                  <th className="px-3 py-2 text-right">Reorder</th>
                  <th className="px-3 py-2">Movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.product_id} className={r.atRisk ? 'bg-surface/60' : undefined}>
                    <td className="px-3 py-2">
                      <Link to={`/products/${r.product_id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      {r.atRisk && (
                        <span className="ml-2 align-middle">
                          <StatusBadge status="warn">At risk</StatusBadge>
                        </span>
                      )}
                      <p className="text-xs text-fg-2">{[r.sku, r.category].filter(Boolean).join(' · ') || ' '}</p>
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {r.quantity} <span className="text-xs text-fg-2">{r.unit}</span>
                    </td>
                    <td className="num px-3 py-2 text-right">{r.units_out}</td>
                    <td className="num px-3 py-2 text-right">{r.dailyUsage}</td>
                    <td className="num px-3 py-2 text-right">{r.daysOfCover ?? '—'}</td>
                    <td className="num px-3 py-2 text-right font-semibold">{r.reorderQty > 0 ? r.reorderQty : '—'}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={VELOCITY_TONE[r.velocity]}>{VELOCITY_LABEL[r.velocity]}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-xs text-fg-2">
        Usage counts stock-out movements (sales, use, transfers out) in the period. Days of cover = on hand ÷ average daily usage. Reorder = enough for 14 days plus the minimum, minus what is on hand.
      </p>
    </>
  )
}
