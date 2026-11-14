import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CameraOff, Keyboard, Plus } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { ExpiryBadge, StockBadge } from '@/components/ui/product-badges'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { can } from '@/domain/permissions'
import { normalizeScan, ScanDeduper, type ScanSource } from '@/domain/scan'
import type { MovementType } from '@/domain/stock'
import { errorMessage } from '@/lib/supabase'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { findProductByCode } from '@/features/products/api'
import { ProductFormDialog } from '@/features/products/ProductFormDialog'
import type { ProductFormInput } from '@/features/products/schema'
import { StockMovementDialog } from '@/features/stock/StockMovementDialog'
import { findIncomingLine, receiveTransfer } from '@/features/transfers/api'
import { outstanding } from '@/domain/transfer'
import { CameraScanner, type CameraScan } from './CameraScanner'
import { scanFeedback } from './feedback'
import { useHidScanner } from './useHidScanner'

interface ScanEvent {
  code: string
  isQr: boolean
  source: ScanSource
  at: number
}

export function ScanPage() {
  const { inventory, role } = useWorkspace()
  const navigate = useNavigate()
  const inventoryId = inventory?.id ?? ''
  const canStock = can(role, 'stock.write')
  const canCreate = can(role, 'product.write')

  const deduper = useRef(new ScanDeduper())
  const feedbackGiven = useRef<number | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [scan, setScan] = useState<ScanEvent | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [stockType, setStockType] = useState<MovementType | null>(null)
  const [creating, setCreating] = useState(false)

  const handleScan = useCallback((raw: string, source: ScanSource, isQr = false) => {
    const result = normalizeScan(raw)
    if (!result.ok) {
      scanFeedback('error')
      setInvalid(result.reason)
      return
    }
    const now = performance.now()
    if (!deduper.current.accept(result.code, now)) return
    setInvalid(null)
    setScan({ code: result.code, isQr, source, at: Date.now() })
    setCameraOn(false) // release the camera while the result is shown
  }, [])

  useHidScanner((code) => handleScan(code, 'scanner'), Boolean(inventory) && !creating && stockType === null)

  const lookup = useQuery({
    // Under the 'products' prefix so stock changes and edits refresh the result.
    queryKey: ['products', 'scan', inventoryId, scan?.code, scan?.at],
    queryFn: async () => {
      const found = await findProductByCode(inventoryId, scan!.code)
      if (feedbackGiven.current !== scan!.at) {
        feedbackGiven.current = scan!.at
        scanFeedback(found ? 'ok' : 'error')
      }
      return found
    },
    enabled: Boolean(inventoryId && scan),
    retry: false,
  })

  const product = lookup.data ?? null

  // Second scan of a transfer: an item that is on its way to this inventory can be received right here.
  const queryClient = useQueryClient()
  const incoming = useQuery({
    queryKey: ['transfers', 'incoming-scan', inventoryId, scan?.code, scan?.at],
    queryFn: () => findIncomingLine(inventoryId, scan!.code),
    enabled: Boolean(inventoryId && scan && canStock),
    retry: false,
  })
  const match = incoming.data ?? null
  const receiveIncoming = useMutation({
    mutationFn: (v: { transferId: string; lineId: string; quantity: number }) =>
      receiveTransfer({ transferId: v.transferId, lines: [{ line_id: v.lineId, quantity: v.quantity }], operationId: crypto.randomUUID() }),
    onSuccess: async () => {
      scanFeedback('ok')
      await Promise.all(
        ['transfers', 'products', 'product', 'movements', 'summary', 'category-stock', 'notifications'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      )
    },
    onError: () => scanFeedback('error'),
  })

  const prefill = useMemo<Partial<ProductFormInput> | undefined>(
    () => (scan ? (scan.isQr ? { qr_code: scan.code } : { barcode: scan.code }) : undefined),
    [scan],
  )

  const reset = () => {
    deduper.current.reset()
    setScan(null)
    setInvalid(null)
  }

  const onManualSubmit = (e: FormEvent) => {
    e.preventDefault()
    handleScan(manual, 'manual')
    setManual('')
  }

  if (!inventory) {
    return (
      <>
        <PageHeader title="Scan" />
        <EmptyState title="No inventory selected" description="Create an inventory first." action={<Button asChild variant="primary"><Link to="/inventories">Go to inventories</Link></Button>} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Scan" description={`${inventory.name} · camera, USB scanner or manual entry`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {cameraOn ? (
            <>
              <CameraScanner onScan={(s: CameraScan) => handleScan(s.text, 'camera', s.isQr)} />
              <Button onClick={() => setCameraOn(false)}>
                <CameraOff className="h-4 w-4" aria-hidden /> Stop camera
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" className="w-full" onClick={() => { reset(); setCameraOn(true) }}>
              <Camera className="h-4 w-4" aria-hidden /> {scan ? 'Scan next with camera' : 'Start camera'}
            </Button>
          )}
          <form onSubmit={onManualSubmit} className="flex gap-2">
            <Input
              data-scan-input
              aria-label="Enter a code manually"
              placeholder="Type or scan a barcode, QR value or SKU"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              autoComplete="off"
              inputMode="text"
            />
            <Button type="submit" disabled={manual.trim() === ''}>
              <Keyboard className="h-4 w-4" aria-hidden /> Look up
            </Button>
          </form>
          <p className="text-xs text-fg-2">
            USB and Bluetooth scanners that act as a keyboard work automatically on this screen. Camera scanning requires a secure (HTTPS) connection and your permission.
          </p>
          {invalid && <p role="alert" className="text-sm text-crit">Invalid scan: {invalid}</p>}
        </div>

        <Panel className="p-4" aria-live="polite">
          {scan && match && (
            <div className="mb-4 space-y-2 rounded-md border border-warn p-3 text-sm" role="status">
              <p>
                <b>Incoming transfer {match.transfer.reference}</b> from {match.transfer.source?.name}:{' '}
                <span className="num">{outstanding(match.line)}</span> × {match.line.product_name} still to arrive.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={receiveIncoming.isPending}
                  onClick={() => receiveIncoming.mutate({ transferId: match.transfer.id, lineId: match.line.id, quantity: 1 })}
                >
                  Receive 1
                </Button>
                {outstanding(match.line) > 1 && (
                  <Button
                    size="sm"
                    disabled={receiveIncoming.isPending}
                    onClick={() => receiveIncoming.mutate({ transferId: match.transfer.id, lineId: match.line.id, quantity: outstanding(match.line) })}
                  >
                    Receive all {outstanding(match.line)}
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/transfers/${match.transfer.id}`}>Open transfer</Link>
                </Button>
              </div>
              {receiveIncoming.isError && (
                <p role="alert" className="text-crit">
                  {errorMessage(receiveIncoming.error)}
                </p>
              )}
            </div>
          )}
          {!scan && <p className="text-sm text-fg-2">Scan a product to see its details and record stock.</p>}
          {scan && lookup.isPending && <LoadingState label={`Looking up ${scan.code}`} />}
          {scan && lookup.isError && <ErrorState message={errorMessage(lookup.error)} onRetry={() => void lookup.refetch()} />}
          {scan && lookup.isSuccess && product && (
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-2">Matched {scan.code}</p>
                <h2 className="text-lg font-semibold">{product.name}</h2>
                <p className="text-sm text-fg-2">{[product.sku && `SKU ${product.sku}`, product.category?.name].filter(Boolean).join(' · ') || ' '}</p>
              </div>
              <p className="num text-3xl font-semibold">
                {product.quantity} <span className="text-base font-normal text-fg-2">{product.unit}</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {product.archived_at && <StatusBadge status="neutral">Archived</StatusBadge>}
                <StockBadge state={product.stock_state} />
                <ExpiryBadge expiresOn={product.expires_on} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {canStock && !product.archived_at && (
                  <>
                    <Button variant="primary" size="lg" onClick={() => setStockType('in')}>Stock in</Button>
                    <Button size="lg" onClick={() => setStockType('out')}>Stock out</Button>
                  </>
                )}
                <Button asChild size="lg" className={canStock && !product.archived_at ? 'col-span-2' : 'col-span-2'}>
                  <Link to={`/products/${product.id}`}>Open details</Link>
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>
              <StockMovementDialog
                open={stockType !== null}
                onOpenChange={(o) => !o && setStockType(null)}
                product={product}
                initialType={stockType ?? 'in'}
                initialAmount="1"
              />
            </div>
          )}
          {scan && lookup.isSuccess && !product && (
            <div className="space-y-3">
              <EmptyState title="No product matches" description={`Nothing in ${inventory.name} uses the code ${scan.code}.`} />
              {canCreate ? (
                <Button variant="primary" className="w-full" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" aria-hidden /> Create product with this code
                </Button>
              ) : (
                <p className="text-sm text-fg-2">You have read-only access, so you cannot create products.</p>
              )}
              <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>
              <ProductFormDialog
                open={creating}
                onOpenChange={setCreating}
                inventoryId={inventory.id}
                product={null}
                initial={prefill}
                onSaved={(id) => navigate(`/products/${id}`)}
              />
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
