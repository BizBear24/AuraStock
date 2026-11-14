import { useMutation } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Panel } from '@/components/ui/panel'
import type { Table } from '@/domain/export'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { buildMovementsTable, buildProductsTable } from './data'
import { downloadBlob, fileStem, toCsv, toXlsx } from './files'

type Job = { dataset: 'products' | 'movements'; format: 'csv' | 'xlsx' }

/** Local midnight at the start of a yyyy-mm-dd day, as an ISO instant. */
function dayStart(day: string, plusDays = 0): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d + plusDays).toISOString()
}

export function ExportPanel() {
  const { inventory } = useWorkspace()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: async ({ dataset, format }: Job) => {
      if (!inventory) throw new Error('No inventory selected')
      const table: Table =
        dataset === 'products'
          ? await buildProductsTable(inventory.id)
          : await buildMovementsTable(inventory.id, from ? dayStart(from) : null, to ? dayStart(to, 1) : null)
      const stamp = new Date().toISOString().slice(0, 10)
      const name = `${fileStem(inventory.name)}-${dataset}-${stamp}.${format}`
      const blob = format === 'csv' ? await toCsv(table) : await toXlsx(table, dataset === 'products' ? 'Products' : 'Movements')
      downloadBlob(blob, name)
      return `${table.rows.length} row${table.rows.length === 1 ? '' : 's'} exported to ${name}`
    },
    onMutate: () => setDone(null),
    onSuccess: setDone,
  })

  const busy = (d: Job['dataset'], f: Job['format']) => run.isPending && run.variables?.dataset === d && run.variables.format === f

  return (
    <Panel className="p-4">
      <h2 className="mb-1 font-semibold">Export</h2>
      <p className="mb-4 text-sm text-fg-2">Download {inventory ? `“${inventory.name}”` : 'the active inventory'} as a spreadsheet. XLSX keeps real numbers and dates; CSV opens anywhere.</p>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">Products</p>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy('products', 'xlsx')} disabled={!inventory || run.isPending} onClick={() => run.mutate({ dataset: 'products', format: 'xlsx' })}>
              <Download className="h-4 w-4" aria-hidden /> Excel (.xlsx)
            </Button>
            <Button loading={busy('products', 'csv')} disabled={!inventory || run.isPending} onClick={() => run.mutate({ dataset: 'products', format: 'csv' })}>
              <Download className="h-4 w-4" aria-hidden /> CSV
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Stock movements</p>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              From <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            </label>
            <label className="flex items-center gap-1.5">
              To <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </label>
            <span className="text-xs text-fg-2">Leave blank for all history. Movements need a connection.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy('movements', 'xlsx')} disabled={!inventory || run.isPending} onClick={() => run.mutate({ dataset: 'movements', format: 'xlsx' })}>
              <Download className="h-4 w-4" aria-hidden /> Excel (.xlsx)
            </Button>
            <Button loading={busy('movements', 'csv')} disabled={!inventory || run.isPending} onClick={() => run.mutate({ dataset: 'movements', format: 'csv' })}>
              <Download className="h-4 w-4" aria-hidden /> CSV
            </Button>
          </div>
        </div>
      </div>

      {run.isError && (
        <p role="alert" className="mt-3 text-sm text-crit">
          {errorMessage(run.error)}
        </p>
      )}
      {done && (
        <p role="status" className="mt-3 text-sm text-ok">
          {done}
        </p>
      )}
    </Panel>
  )
}
