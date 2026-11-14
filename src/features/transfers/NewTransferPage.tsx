import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { addToDraft, draftProblem, setDraftQuantity, toDispatchLines, type DraftLine } from '@/domain/transfer'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { findProductByCode } from '@/features/products/api'
import { scanFeedback } from '@/features/scan/feedback'
import { ScanIntake } from '@/features/scan/ScanIntake'
import { useOffline } from '@/offline/OfflineProvider'
import { dispatchTransfer } from './api'

const REFRESH = ['transfers', 'products', 'product', 'movements', 'movement-summary', 'summary', 'category-stock', 'notifications']

/** Step 1 of a transfer: scan items out of the active inventory and send them to another one. */
export function NewTransferPage() {
  const { organization, role, inventory, inventories } = useWorkspace()
  const { snapshot } = useOffline()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [destinationId, setDestinationId] = useState('')
  const [draft, setDraft] = useState<DraftLine[]>([])
  // Mirror of `draft` for scan callbacks that can fire several times before a re-render.
  const draftRef = useRef<DraftLine[]>([])
  const commit = useCallback((next: DraftLine[]) => {
    draftRef.current = next
    setDraft(next)
  }, [])
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // One idempotency key per dispatch attempt: a retry after a dropped connection cannot create two transfers.
  const [operationId] = useState(() => crypto.randomUUID())

  const destinations = inventories.filter((i) => i.id !== inventory?.id)
  const problem = draftProblem(draft, destinationId || null)

  const lookup = useMutation({
    mutationFn: (code: string) => findProductByCode(inventory!.id, code),
    onSuccess: (product, code) => {
      if (!product) {
        scanFeedback('error')
        setMessage({ tone: 'error', text: `No product in ${inventory?.name} matches ${code}.` })
        return
      }
      const result = addToDraft(draftRef.current, product)
      if (!result.ok) {
        scanFeedback('error')
        setMessage({ tone: 'error', text: result.error })
        return
      }
      scanFeedback('ok')
      const qty = result.draft.find((l) => l.productId === product.id)?.quantity ?? 1
      setMessage({ tone: 'ok', text: `Added ${product.name} (${qty} ${product.unit})` })
      commit(result.draft)
    },
    onError: (e) => {
      scanFeedback('error')
      setMessage({ tone: 'error', text: errorMessage(e) })
    },
  })

  const onCode = useCallback((code: string) => lookup.mutate(code), [lookup])

  const dispatch = useMutation({
    mutationFn: () =>
      dispatchTransfer({ sourceId: inventory!.id, destinationId, lines: toDispatchLines(draft), note: note.trim() || null, operationId }),
    onSuccess: async (id) => {
      await Promise.all(REFRESH.map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
      navigate(`/transfers/${id}`)
    },
  })

  if (!inventory) return <EmptyState title="No inventory selected" description="Create an inventory first." />
  if (!can(role, 'stock.write')) {
    return (
      <>
        <PageHeader title="New transfer" />
        <EmptyState title="Read-only access" description="Only editors, admins and owners can dispatch transfers." />
      </>
    )
  }
  if (destinations.length === 0) {
    return (
      <>
        <PageHeader title="New transfer" />
        <EmptyState
          title="You need a second inventory"
          description="Transfers move stock between two inventories (locations) of your organization. Create another inventory first, or switch on the demo data."
          action={
            <Button asChild variant="primary">
              <Link to="/inventories">Go to inventories</Link>
            </Button>
          }
        />
      </>
    )
  }

  const units = draft.reduce((s, l) => s + l.quantity, 0)

  return (
    <>
      <PageHeader title="New transfer" description={`Dispatch from ${organization.organizationName} · ${inventory.name}`} />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Panel className="p-4">
            <label htmlFor="destination" className="mb-1 block text-[13px] font-medium">
              Send to
            </label>
            <select
              id="destination"
              className="h-9 w-full rounded-md border border-line bg-bg-2 px-2 text-sm"
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
            >
              <option value="">Choose a destination…</option>
              {destinations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.is_demo ? ' (demo)' : ''}
                </option>
              ))}
            </select>
            <label htmlFor="transfer-note" className="mb-1 mt-3 block text-[13px] font-medium">
              Note (optional)
            </label>
            <Input id="transfer-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Friday delivery, truck 4" />
          </Panel>
          <Panel className="p-4">
            <h2 className="mb-3 font-semibold">Scan items to send</h2>
            <ScanIntake onCode={onCode} disabled={dispatch.isPending} />
            {message && (
              <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${message.tone === 'error' ? 'text-crit' : 'text-ok'}`}>
                {message.text}
              </p>
            )}
          </Panel>
        </div>

        <Panel className="flex flex-col overflow-hidden">
          <h2 className="border-b border-line px-4 py-2 font-semibold">
            Items to dispatch <span className="num font-normal text-fg-2">· {draft.length} line{draft.length === 1 ? '' : 's'}, {units} unit{units === 1 ? '' : 's'}</span>
          </h2>
          {draft.length === 0 ? (
            <p className="p-4 text-sm text-fg-2">Nothing scanned yet. Scan a barcode or QR code, or type a SKU.</p>
          ) : (
            <ul className="divide-y divide-line">
              {draft.map((l) => (
                <li key={l.productId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.name}</p>
                    <p className="num text-xs text-fg-2">
                      {l.sku ? `${l.sku} · ` : ''}
                      {l.available} {l.unit} available
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" aria-label={`Decrease ${l.name}`} onClick={() => commit(setDraftQuantity(draftRef.current, l.productId, l.quantity - 1))}>
                      <Minus className="h-4 w-4" aria-hidden />
                    </Button>
                    <Input
                      aria-label={`Quantity of ${l.name}`}
                      className="num w-20 text-center"
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (Number.isFinite(n)) commit(setDraftQuantity(draftRef.current, l.productId, n))
                      }}
                    />
                    <Button size="icon" aria-label={`Increase ${l.name}`} disabled={l.quantity >= l.available} onClick={() => commit(setDraftQuantity(draftRef.current, l.productId, l.quantity + 1))}>
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Remove ${l.name}`} onClick={() => commit(setDraftQuantity(draftRef.current, l.productId, 0))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto border-t border-line p-4">
            {dispatch.isError && (
              <p role="alert" className="mb-3 rounded-md border border-crit px-3 py-2 text-sm text-crit">
                Nothing was dispatched. {errorMessage(dispatch.error)}
              </p>
            )}
            {!snapshot.online && <p role="alert" className="mb-3 text-sm text-warn">You are offline. Transfers need a connection.</p>}
            {problem && draft.length > 0 && <p className="mb-3 text-sm text-fg-2">{problem}</p>}
            <p className="mb-3 text-xs text-fg-2">Dispatching removes the stock from {inventory.name} now. It stays “in transit” until it is scanned in at the destination.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={dispatch.isPending} disabled={Boolean(problem) || !snapshot.online} onClick={() => dispatch.mutate()}>
                Dispatch transfer
              </Button>
              <Button asChild>
                <Link to="/transfers">Cancel</Link>
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}
