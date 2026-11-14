import { useMutation } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/states'
import { errorMessage } from '@/lib/supabase'
import { fetchAllMovements, fetchAllProducts } from '@/features/data/data'
import { downloadBlob, fileStem } from '@/features/data/files'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { buildPdf, type PdfSpec } from './pdf'
import { inventoryReport, movementReport, stockSummaryReport } from './reports'

type Kind = 'inventory' | 'summary' | 'movements'

function localDay(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayStart(day: string, plusDays = 0): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d + plusDays).toISOString()
}

function ReportCard({ title, description, children, action }: { title: string; description: string; children?: ReactNode; action: ReactNode }) {
  return (
    <Panel className="flex flex-col p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <FileText className="h-4 w-4 text-fg-2" aria-hidden /> {title}
      </h2>
      <p className="mt-1 text-sm text-fg-2">{description}</p>
      {children && <div className="mt-3">{children}</div>}
      <div className="mt-4">{action}</div>
    </Panel>
  )
}

export function ReportsPage() {
  const { organization, inventory } = useWorkspace()
  const [from, setFrom] = useState(() => localDay(-30))
  const [to, setTo] = useState(() => localDay())
  const [done, setDone] = useState<string | null>(null)

  const generate = useMutation({
    mutationFn: async (kind: Kind) => {
      if (!inventory) throw new Error('No inventory selected')
      if (kind === 'movements' && (!from || !to || from > to)) throw new Error('Choose a valid date range: the start must not be after the end.')
      const ctx = { organization: organization.organizationName, inventory: inventory.name, generatedAt: new Date() }
      let spec: PdfSpec
      if (kind === 'movements') {
        const rows = await fetchAllMovements(inventory.id, dayStart(from), dayStart(to, 1))
        spec = movementReport(rows, ctx, { fromLabel: from, toLabel: to })
      } else {
        const products = await fetchAllProducts(inventory.id)
        spec = kind === 'inventory' ? inventoryReport(products, ctx) : stockSummaryReport(products, ctx)
      }
      const blob = await buildPdf(spec)
      const name = `${fileStem(inventory.name)}-${kind}-${localDay()}.pdf`
      downloadBlob(blob, name)
      return name
    },
    onMutate: () => setDone(null),
    onSuccess: (name) => setDone(`Saved ${name}`),
  })

  if (!inventory) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState title="No inventory selected" description="Create an inventory first." />
      </>
    )
  }
  const running = (k: Kind) => generate.isPending && generate.variables === k

  return (
    <>
      <PageHeader title="Reports" description={`${inventory.name} · PDF`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ReportCard
          title="Inventory report"
          description="Every active product with quantity, minimum, status and expiry, plus summary figures."
          action={
            <Button variant="primary" loading={running('inventory')} disabled={generate.isPending} onClick={() => generate.mutate('inventory')}>
              Download PDF
            </Button>
          }
        />
        <ReportCard
          title="Stock summary"
          description="Totals per category and a list of everything that is out, low, expired or expiring."
          action={
            <Button variant="primary" loading={running('summary')} disabled={generate.isPending} onClick={() => generate.mutate('summary')}>
              Download PDF
            </Button>
          }
        />
        <ReportCard
          title="Movement report"
          description="Every stock movement in a period with units in, units out and net change. Needs a connection."
          action={
            <Button variant="primary" loading={running('movements')} disabled={generate.isPending} onClick={() => generate.mutate('movements')}>
              Download PDF
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              From <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            </label>
            <label className="flex items-center gap-1.5">
              To <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </label>
          </div>
        </ReportCard>
      </div>
      {generate.isError && (
        <p role="alert" className="mt-4 text-sm text-crit">
          {errorMessage(generate.error)}
        </p>
      )}
      {done && (
        <p role="status" className="mt-4 text-sm text-ok">
          {done}
        </p>
      )}
      <p className="mt-4 text-xs text-fg-2">Reports use a standard PDF font: characters outside Western European alphabets are shown as “?”. Use the Excel export for full Unicode text.</p>
    </>
  )
}
