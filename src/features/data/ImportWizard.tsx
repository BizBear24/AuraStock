import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { StatusBadge, type Status } from '@/components/ui/status-badge'
import {
  autoMapColumns,
  buildExistingIndex,
  explainImportError,
  FIELD_LABEL,
  IMPORT_FIELDS,
  mappingProblems,
  previewImport,
  type ColumnMapping,
  type ImportField,
  type PreviewRow,
  type RawTable,
  type RowAction,
} from '@/domain/import'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { useOffline } from '@/offline/OfflineProvider'
import { fetchAllProducts, importProducts, type ImportResult } from './data'
import { readTable } from './files'

const ACTION: Record<RowAction, { label: string; status: Status }> = {
  create: { label: 'New', status: 'ok' },
  update: { label: 'Update', status: 'info' },
  skip: { label: 'Skip', status: 'neutral' },
  invalid: { label: 'Invalid', status: 'crit' },
}

interface Loaded {
  fileName: string
  table: RawTable
  existing: ReturnType<typeof buildExistingIndex>
}

export function ImportWizard({ canImport }: { canImport: boolean }) {
  const { inventory } = useWorkspace()
  const { snapshot } = useOffline()
  const queryClient = useQueryClient()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [step, setStep] = useState<'choose' | 'map' | 'preview' | 'done'>('choose')
  const [updateExisting, setUpdateExisting] = useState(false)
  const [skipInvalid, setSkipInvalid] = useState(false)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [result, setResult] = useState<ImportResult | null>(null)

  const load = useMutation({
    mutationFn: async (file: File): Promise<Loaded> => {
      if (!inventory) throw new Error('No inventory selected')
      const table = await readTable(file)
      const existing = buildExistingIndex(await fetchAllProducts(inventory.id))
      return { fileName: file.name, table, existing }
    },
    onSuccess: (data) => {
      setLoaded(data)
      setMapping(autoMapColumns(data.table.headers))
      setStep('map')
      setSkipInvalid(false)
      setUpdateExisting(false)
      setResult(null)
      setOperationId(crypto.randomUUID())
    },
  })

  const problems = mapping ? mappingProblems(mapping) : []
  const preview = useMemo(
    () => (loaded && mapping && problems.length === 0 ? previewImport(loaded.table, mapping, loaded.existing, { updateExisting }) : null),
    // `problems` is derived from `mapping`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, mapping, updateExisting],
  )

  const toSend = preview?.rows.filter((r): r is PreviewRow & { row: NonNullable<PreviewRow['row']> } => (r.action === 'create' || r.action === 'update') && r.row !== null) ?? []

  const commit = useMutation({
    mutationFn: () => importProducts({ inventoryId: inventory!.id, rows: toSend.map((r) => r.row), updateExisting, operationId }),
    onSuccess: async (r) => {
      setResult(r)
      setStep('done')
      await Promise.all(
        ['products', 'product', 'summary', 'category-stock', 'movements', 'movement-summary', 'categories', 'tags', 'notifications'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      )
    },
  })

  const reset = () => {
    setLoaded(null)
    setMapping(null)
    setStep('choose')
    setResult(null)
    commit.reset()
    load.reset()
  }

  if (!canImport) {
    return (
      <Panel className="p-4">
        <h2 className="mb-1 font-semibold">Import</h2>
        <p className="text-sm text-fg-2">Only editors, admins and owners can import products.</p>
      </Panel>
    )
  }

  return (
    <Panel className="p-4">
      <h2 className="mb-1 font-semibold">Import products</h2>
      <p className="mb-4 text-sm text-fg-2">
        From a .csv or .xlsx file. You will map the columns and review every row before anything is saved. The import is all-or-nothing.
      </p>

      {!snapshot.online && <p role="alert" className="mb-3 text-sm text-warn">You are offline. Importing needs a connection.</p>}

      {step === 'choose' && (
        <div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-fg bg-fg px-4 text-sm font-medium text-bg hover:opacity-90 aria-disabled:opacity-50">
            <Upload className="h-4 w-4" aria-hidden />
            {load.isPending ? 'Reading file…' : 'Choose file'}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv"
              className="sr-only"
              disabled={!inventory || !snapshot.online || load.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) load.mutate(file)
              }}
            />
          </label>
          {load.isError && (
            <p role="alert" className="mt-3 text-sm text-crit">
              {errorMessage(load.error)}
            </p>
          )}
        </div>
      )}

      {loaded && mapping && step === 'map' && (
        <div className="space-y-3">
          <p className="text-sm">
            <b>{loaded.fileName}</b> · {loaded.table.rows.length} data row{loaded.table.rows.length === 1 ? '' : 's'}
          </p>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-fg-2">
                <tr>
                  <th className="px-3 py-2">AuraStock field</th>
                  <th className="px-3 py-2">Column in your file</th>
                  <th className="px-3 py-2">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {IMPORT_FIELDS.map((field: ImportField) => {
                  const idx = mapping[field]
                  const example = idx === null ? '' : loaded.table.rows.slice(0, 3).map((r) => r[idx] ?? '').filter(Boolean).join(' · ')
                  return (
                    <tr key={field}>
                      <td className="px-3 py-2">
                        {FIELD_LABEL[field]} {field === 'name' && <span className="text-crit" aria-label="required">*</span>}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Column for ${FIELD_LABEL[field]}`}
                          className="h-8 w-full min-w-40 rounded-md border border-line bg-bg-2 px-2 text-sm"
                          value={idx === null ? '' : String(idx)}
                          onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                          <option value="">— not imported —</option>
                          {loaded.table.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="max-w-xs truncate px-3 py-2 text-fg-2">{example}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {problems.map((p) => (
            <p key={p} role="alert" className="text-sm text-crit">
              {p}
            </p>
          ))}
          <div className="flex gap-2">
            <Button onClick={reset}>Cancel</Button>
            <Button variant="primary" disabled={problems.length > 0} onClick={() => setStep('preview')}>
              Review rows
            </Button>
          </div>
        </div>
      )}

      {loaded && preview && step === 'preview' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {(['create', 'update', 'skip', 'invalid'] as RowAction[]).map((a) => (
              <StatusBadge key={a} status={ACTION[a].status}>
                {preview.counts[a]} {ACTION[a].label.toLowerCase()}
              </StatusBadge>
            ))}
          </div>
          {preview.overLimit && <p role="alert" className="text-sm text-crit">Only the first 5000 rows are read. Split the file to import the rest.</p>}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
            Update products that already exist (matched by barcode, QR value or SKU). Quantities are never changed by an import of existing products.
          </label>

          <PreviewTable rows={preview.rows} />

          {preview.counts.invalid > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
              Do not import the {preview.counts.invalid} invalid row{preview.counts.invalid === 1 ? '' : 's'} (they will be left out, not changed)
            </label>
          )}
          {commit.isError && (
            <p role="alert" className="rounded-md border border-crit px-3 py-2 text-sm text-crit">
              Nothing was imported. {explainImportError(errorMessage(commit.error), toSend.map((r) => r.line))}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStep('map')}>Back</Button>
            <Button onClick={reset}>Cancel</Button>
            <Button
              variant="primary"
              loading={commit.isPending}
              disabled={!snapshot.online || toSend.length === 0 || (preview.counts.invalid > 0 && !skipInvalid)}
              onClick={() => commit.mutate()}
            >
              Import {toSend.length} product{toSend.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-3" role="status">
          <p className="text-sm">
            Import complete: <b>{result.created}</b> created, <b>{result.updated}</b> updated{result.skipped > 0 ? `, ${result.skipped} skipped` : ''}.
          </p>
          <div className="flex gap-2">
            <Button asChild variant="primary">
              <Link to="/products">View products</Link>
            </Button>
            <Button onClick={reset}>Import another file</Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  // Problems first so they cannot be missed, then a sample of the rest.
  const shown = [...rows.filter((r) => r.action === 'invalid').slice(0, 100), ...rows.filter((r) => r.action !== 'invalid').slice(0, 25)]
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 border-b border-line bg-surface text-xs uppercase tracking-wide text-fg-2">
          <tr>
            <th className="px-3 py-2">Line</th>
            <th className="px-3 py-2">Result</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">SKU</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r) => (
            <tr key={r.line}>
              <td className="num px-3 py-2 text-fg-2">{r.line}</td>
              <td className="px-3 py-2">
                <StatusBadge status={ACTION[r.action].status}>{ACTION[r.action].label}</StatusBadge>
              </td>
              <td className="px-3 py-2">{r.row?.name ?? '—'}</td>
              <td className="num px-3 py-2 text-fg-2">{r.row?.sku ?? '—'}</td>
              <td className="num px-3 py-2 text-right">{r.row?.quantity ?? '—'}</td>
              <td className={`px-3 py-2 ${r.errors.length ? 'text-crit' : 'text-fg-2'}`}>{[...r.errors, ...r.notes].join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && <p className="border-t border-line px-3 py-2 text-xs text-fg-2">Showing {shown.length} of {rows.length} rows: all problems first, then a sample.</p>}
    </div>
  )
}
