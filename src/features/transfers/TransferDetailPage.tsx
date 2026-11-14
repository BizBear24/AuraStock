import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge, type Status } from '@/components/ui/status-badge'
import { can } from '@/domain/permissions'
import { findLineByCode, lineState, outstanding, totalOutstanding, totalSent, TRANSFER_STATUS_LABEL, type LineState } from '@/domain/transfer'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { scanFeedback } from '@/features/scan/feedback'
import { ScanIntake } from '@/features/scan/ScanIntake'
import { useOffline } from '@/offline/OfflineProvider'
import { cancelTransfer, closeTransfer, getTransfer, receiveTransfer, type TransferLine } from './api'
import { STATUS_TONE } from './TransfersPage'

const REFRESH = ['transfers', 'transfer', 'products', 'product', 'movements', 'movement-summary', 'summary', 'category-stock', 'notifications']

const LINE_BADGE: Record<LineState, { label: string; status: Status }> = {
  waiting: { label: 'Waiting', status: 'neutral' },
  partial: { label: 'Partial', status: 'warn' },
  received: { label: 'Received', status: 'ok' },
  short: { label: 'Short', status: 'crit' },
}

/** Step 2 of a transfer: scan items in when they arrive. */
export function TransferDetailPage() {
  const { id = '' } = useParams()
  const { role } = useWorkspace()
  const { snapshot } = useOffline()
  const queryClient = useQueryClient()
  const canAct = can(role, 'stock.write')
  const [log, setLog] = useState<{ tone: 'ok' | 'error'; text: string }[]>([])
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null)
  const [closeNote, setCloseNote] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  const query = useQuery({ queryKey: ['transfer', id], queryFn: () => getTransfer(id), enabled: Boolean(id) })
  const transfer = query.data

  const refresh = () => Promise.all(REFRESH.map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
  const note = (tone: 'ok' | 'error', text: string) => setLog((l) => [{ tone, text }, ...l].slice(0, 8))

  const receive = useMutation({
    mutationFn: (v: { line: TransferLine; quantity: number }) =>
      // A fresh operation id per scan; a retry of the same scan would reuse it, so it never counts twice.
      receiveTransfer({ transferId: id, lines: [{ line_id: v.line.id, quantity: v.quantity }], operationId: crypto.randomUUID() }),
    onSuccess: async (result, v) => {
      scanFeedback('ok')
      note('ok', `Received ${v.quantity} × ${v.line.product_name}${result.status === 'completed' ? ' · transfer complete' : ''}`)
      await refresh()
    },
    onError: (e, v) => {
      scanFeedback('error')
      note('error', `${v.line.product_name}: ${errorMessage(e)}`)
    },
  })

  const onCode = useCallback(
    (code: string) => {
      if (!transfer) return
      const line = findLineByCode(transfer.lines, code)
      if (!line) {
        scanFeedback('error')
        note('error', `${code} is not part of ${transfer.reference}.`)
      } else if (outstanding(line) <= 0) {
        scanFeedback('error')
        note('error', `${line.product_name}: everything sent has already been received.`)
      } else {
        receive.mutate({ line, quantity: 1 })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transfer, receive.mutate],
  )

  const finish = useMutation({
    mutationFn: async () => {
      if (confirm === 'cancel') await cancelTransfer(id)
      else await closeTransfer(id, closeNote.trim() || null)
    },
    onSuccess: async () => {
      setConfirm(null)
      await refresh()
    },
  })

  if (query.isPending) return <LoadingState />
  if (query.isError || !transfer) return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />

  const inTransit = transfer.status === 'in_transit'
  const sent = totalSent(transfer.lines)
  const missing = totalOutstanding(transfer.lines)
  const anyReceived = transfer.lines.some((l) => l.quantity_received > 0)

  return (
    <>
      <Link to="/transfers" className="mb-2 inline-flex items-center gap-1 text-sm text-fg-2 hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Transfers
      </Link>
      <PageHeader
        title={transfer.reference}
        description={undefined}
        actions={<StatusBadge status={STATUS_TONE[transfer.status]}>{TRANSFER_STATUS_LABEL[transfer.status]}</StatusBadge>}
      />
      <p className="-mt-2 mb-4 flex flex-wrap items-center gap-1.5 text-sm">
        <b>{transfer.source?.name ?? 'Unknown'}</b> <ArrowRight className="h-4 w-4 text-fg-2" aria-hidden /> <b>{transfer.destination?.name ?? 'Unknown'}</b>
        <span className="num text-fg-2">· dispatched {new Date(transfer.dispatched_at).toLocaleString()}</span>
      </p>
      {transfer.note && <p className="mb-3 text-sm text-fg-2">Note: {transfer.note}</p>}
      {transfer.closed_note && <p className="mb-3 text-sm text-fg-2">Closing note: {transfer.closed_note}</p>}

      {transfer.status === 'completed' && missing > 0 && (
        <p role="status" className="mb-3 rounded-md border border-crit px-3 py-2 text-sm text-crit">
          Closed with a shortage: <span className="num">{missing}</span> of <span className="num">{sent}</span> units sent did not arrive.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {inTransit && canAct ? (
          <div className="space-y-4">
            <Panel className="p-4">
              <h2 className="mb-1 font-semibold">Scan items in</h2>
              <p className="mb-3 text-sm text-fg-2">Scan each item as it arrives at {transfer.destination?.name}. Every scan adds one unit to that inventory.</p>
              {!snapshot.online && <p role="alert" className="mb-3 text-sm text-warn">You are offline. Receiving needs a connection.</p>}
              <ScanIntake onCode={onCode} disabled={!snapshot.online} />
            </Panel>
            {log.length > 0 && (
              <Panel className="p-4" aria-live="polite">
                <h2 className="mb-2 text-sm font-semibold">Recent scans</h2>
                <ul className="space-y-1 text-sm">
                  {log.map((l, i) => (
                    <li key={i} className={l.tone === 'error' ? 'text-crit' : 'text-ok'}>
                      {l.text}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        ) : (
          <Panel className="h-fit p-4 text-sm text-fg-2">
            {inTransit ? 'You have read-only access. Only editors, admins and owners can receive transfers.' : `This transfer is ${TRANSFER_STATUS_LABEL[transfer.status].toLowerCase()}.`}
          </Panel>
        )}

        <Panel className="overflow-hidden">
          <h2 className="border-b border-line px-4 py-2 font-semibold">
            Items <span className="num font-normal text-fg-2">· {sent - missing} of {sent} units arrived</span>
          </h2>
          <ul className="divide-y divide-line">
            {transfer.lines.map((l) => {
              const state = lineState(l, transfer.status)
              const left = outstanding(l)
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.product_name}</p>
                    <p className="num text-xs text-fg-2">
                      {l.sku ? `${l.sku} · ` : ''}
                      {l.quantity_received} / {l.quantity_sent} {l.unit}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={LINE_BADGE[state].status}>{LINE_BADGE[state].label}</StatusBadge>
                    {inTransit && canAct && left > 0 && (
                      <>
                        <Input
                          aria-label={`Quantity to receive of ${l.product_name}`}
                          className="num w-20 text-center"
                          inputMode="decimal"
                          placeholder={String(left)}
                          value={amounts[l.id] ?? ''}
                          onChange={(e) => setAmounts({ ...amounts, [l.id]: e.target.value })}
                        />
                        <Button
                          size="sm"
                          disabled={!snapshot.online || receive.isPending}
                          onClick={() => {
                            const n = amounts[l.id] ? Number(amounts[l.id]) : left
                            if (!Number.isFinite(n) || n <= 0 || n > left) {
                              note('error', `${l.product_name}: enter a quantity between 0 and ${left}.`)
                              return
                            }
                            setAmounts({ ...amounts, [l.id]: '' })
                            receive.mutate({ line: l, quantity: n })
                          }}
                        >
                          {amounts[l.id] ? 'Receive' : 'Receive all'}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {inTransit && canAct && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
              {!anyReceived && (
                <Button variant="danger" onClick={() => setConfirm('cancel')}>
                  Cancel transfer
                </Button>
              )}
              {anyReceived && (
                <Button onClick={() => setConfirm('close')}>Close with shortage</Button>
              )}
              <p className="text-xs text-fg-2">
                {anyReceived
                  ? 'Close it if the remaining units will not arrive. The shortage is recorded and an alert is raised.'
                  : 'Cancelling returns everything to the source inventory.'}
              </p>
            </div>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'cancel' ? 'Cancel this transfer?' : 'Close with a shortage?'}
        description={
          confirm === 'cancel'
            ? `All ${sent} units go back to ${transfer.source?.name} as stock in. Nothing has been received yet.`
            : `${missing} unit(s) that were sent have not arrived. They will be recorded as missing and will not be added back to either inventory.`
        }
        confirmLabel={confirm === 'cancel' ? 'Cancel transfer' : 'Close transfer'}
        destructive
        loading={finish.isPending}
        error={finish.isError ? errorMessage(finish.error) : null}
        onConfirm={() => finish.mutate()}
      >
        {confirm === 'close' && (
          <Input aria-label="Closing note" placeholder="Closing note (optional), e.g. one box damaged" maxLength={500} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
        )}
      </ConfirmDialog>
    </>
  )
}

