import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Transfer } from './api'

const dispatchTransfer = vi.fn()
const receiveTransfer = vi.fn()
const closeTransfer = vi.fn()
const cancelTransfer = vi.fn()
const getTransfer = vi.fn()
const findProductByCode = vi.fn()

let role = 'editor'
let online = true
let scanHandler: (code: string) => void = () => undefined

vi.mock('./api', () => ({
  dispatchTransfer: (...a: unknown[]) => dispatchTransfer(...a),
  receiveTransfer: (...a: unknown[]) => receiveTransfer(...a),
  closeTransfer: (...a: unknown[]) => closeTransfer(...a),
  cancelTransfer: (...a: unknown[]) => cancelTransfer(...a),
  getTransfer: (...a: unknown[]) => getTransfer(...a),
}))
vi.mock('@/features/products/api', () => ({ findProductByCode: (...a: unknown[]) => findProductByCode(...a) }))
vi.mock('@/features/scan/feedback', () => ({ scanFeedback: () => undefined }))
vi.mock('@/offline/OfflineProvider', () => ({ useOffline: () => ({ snapshot: { online } }) }))
vi.mock('@/features/scan/ScanIntake', () => ({
  ScanIntake: ({ onCode }: { onCode: (code: string) => void }) => {
    scanHandler = onCode
    return <button type="button" onClick={() => onCode('PENDING')}>mock scanner</button>
  },
}))
vi.mock('@/features/organizations/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    organization: { organizationId: 'org', organizationName: 'Acme', role },
    role,
    inventory: { id: 'wh', name: 'Warehouse', is_demo: false },
    inventories: [
      { id: 'wh', name: 'Warehouse', is_demo: false },
      { id: 'shop', name: 'Shop', is_demo: false },
    ],
  }),
}))

const { NewTransferPage } = await import('./NewTransferPage')
const { TransferDetailPage } = await import('./TransferDetailPage')

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

const product = (over: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Rice 5kg', sku: 'R-5', unit: 'bag', quantity: 3, archived_at: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  role = 'editor'
  online = true
})

describe('NewTransferPage', () => {
  const show = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/transfers/new']}>
          <Routes>
            <Route path="/transfers/new" element={<NewTransferPage />} />
            <Route path="/transfers/:id" element={<p>detail page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('adds scanned items, counts repeat scans, and stops at available stock', async () => {
    findProductByCode.mockResolvedValue(product())
    const user = userEvent.setup()
    show()
    const scan = screen.getByRole('button', { name: 'mock scanner' })
    await user.click(scan)
    expect(await screen.findByText(/Added Rice 5kg \(1 bag\)/)).toBeInTheDocument()
    await user.click(scan)
    await waitFor(() => expect(screen.getByLabelText('Quantity of Rice 5kg')).toHaveValue('2'))
    await user.click(scan)
    await waitFor(() => expect(screen.getByLabelText('Quantity of Rice 5kg')).toHaveValue('3'))
    await user.click(scan)
    expect(await screen.findByText('Only 3 bag of Rice 5kg available.')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity of Rice 5kg')).toHaveValue('3')
  })

  it('reports unknown codes without changing the list', async () => {
    findProductByCode.mockResolvedValue(null)
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'mock scanner' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No product in Warehouse matches PENDING.')
    expect(screen.getByText(/Nothing scanned yet/)).toBeInTheDocument()
  })

  it('needs a destination and items before dispatching, then dispatches once with the right lines', async () => {
    findProductByCode.mockResolvedValue(product())
    dispatchTransfer.mockResolvedValue('t-1')
    const user = userEvent.setup()
    show()
    const dispatchButton = screen.getByRole('button', { name: 'Dispatch transfer' })
    expect(dispatchButton).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'mock scanner' }))
    await screen.findByLabelText('Quantity of Rice 5kg')
    expect(dispatchButton).toBeDisabled() // still no destination
    await user.selectOptions(screen.getByLabelText('Send to'), 'shop')
    await user.type(screen.getByLabelText(/Note/), 'Friday truck')
    expect(dispatchButton).toBeEnabled()
    await user.click(dispatchButton)
    await waitFor(() => expect(dispatchTransfer).toHaveBeenCalledTimes(1))
    expect(dispatchTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'wh', destinationId: 'shop', note: 'Friday truck', lines: [{ product_id: 'p1', quantity: 1 }] }),
    )
    expect(await screen.findByText('detail page')).toBeInTheDocument()
  })

  it('shows server rejections and keeps the list so the user can fix it', async () => {
    findProductByCode.mockResolvedValue(product())
    dispatchTransfer.mockRejectedValue({ message: 'Rice 5kg: Insufficient stock: 1 available, 2 requested' })
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'mock scanner' }))
    await screen.findByLabelText('Quantity of Rice 5kg')
    await user.selectOptions(screen.getByLabelText('Send to'), 'shop')
    await user.click(screen.getByRole('button', { name: 'Dispatch transfer' }))
    expect(await screen.findByText(/Nothing was dispatched\. Rice 5kg: Insufficient stock/)).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity of Rice 5kg')).toBeInTheDocument()
  })

  it('is blocked for read-only members and while offline', async () => {
    role = 'viewer'
    const { unmount } = show()
    expect(screen.getByText('Read-only access')).toBeInTheDocument()
    unmount()
    role = 'editor'
    online = false
    findProductByCode.mockResolvedValue(product())
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'mock scanner' }))
    await screen.findByLabelText('Quantity of Rice 5kg')
    await user.selectOptions(screen.getByLabelText('Send to'), 'shop')
    expect(screen.getByRole('button', { name: 'Dispatch transfer' })).toBeDisabled()
    expect(screen.getByText(/You are offline/)).toBeInTheDocument()
  })
})

describe('TransferDetailPage', () => {
  const transfer = (over: Partial<Transfer> = {}): Transfer => ({
    id: 't-1',
    reference: 'TR-00007',
    status: 'in_transit',
    note: 'Friday truck',
    closed_note: null,
    dispatched_at: '2026-11-14T10:00:00Z',
    completed_at: null,
    cancelled_at: null,
    source_inventory_id: 'wh',
    destination_inventory_id: 'shop',
    source: { id: 'wh', name: 'Warehouse' },
    destination: { id: 'shop', name: 'Shop' },
    lines: [
      { id: 'l1', source_product_id: 'p1', destination_product_id: null, product_name: 'Rice 5kg', sku: 'R-5', barcode: '8901234567890', qr_code: null, unit: 'bag', quantity_sent: 8, quantity_received: 0 },
      { id: 'l2', source_product_id: 'p2', destination_product_id: null, product_name: 'Oil 1L', sku: 'O-1', barcode: null, qr_code: null, unit: 'btl', quantity_sent: 2, quantity_received: 0 },
    ],
    ...over,
  })

  const show = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/transfers/t-1']}>
          <Routes>
            <Route path="/transfers/:id" element={<TransferDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('shows progress and lets you cancel only before anything is received', async () => {
    getTransfer.mockResolvedValue(transfer())
    show()
    expect(await screen.findByText('TR-00007')).toBeInTheDocument()
    expect(screen.getByText('In transit')).toBeInTheDocument()
    expect(screen.getByText(/0 of 10 units arrived/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close with shortage' })).toBeNull()
  })

  it('receives one unit per scan of a matching code and refuses codes from another transfer', async () => {
    getTransfer.mockResolvedValue(transfer({ lines: transfer().lines.map((l) => (l.id === 'l1' ? { ...l, barcode: 'PENDING' } : l)) }))
    receiveTransfer.mockResolvedValue({ status: 'in_transit', outstanding: 9 })
    const user = userEvent.setup()
    show()
    await screen.findByText('TR-00007')
    await user.click(screen.getByRole('button', { name: 'mock scanner' }))
    await waitFor(() => expect(receiveTransfer).toHaveBeenCalledTimes(1))
    expect(receiveTransfer).toHaveBeenCalledWith(expect.objectContaining({ transferId: 't-1', lines: [{ line_id: 'l1', quantity: 1 }] }))
    expect(await screen.findByText('Received 1 × Rice 5kg')).toBeInTheDocument()

    scanHandler('SOMETHING-ELSE')
    expect(await screen.findByText('SOMETHING-ELSE is not part of TR-00007.')).toBeInTheDocument()
    expect(receiveTransfer).toHaveBeenCalledTimes(1)
  })

  it('can receive a whole line or a typed quantity, and validates it', async () => {
    getTransfer.mockResolvedValue(transfer())
    receiveTransfer.mockResolvedValue({ status: 'in_transit', outstanding: 5 })
    const user = userEvent.setup()
    show()
    await screen.findByText('TR-00007')
    await user.type(screen.getByLabelText('Quantity to receive of Rice 5kg'), '99')
    await user.click(screen.getAllByRole('button', { name: 'Receive' })[0]!)
    expect(await screen.findByText('Rice 5kg: enter a quantity between 0 and 8.')).toBeInTheDocument()
    expect(receiveTransfer).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Receive all' })) // only the untouched line still says "Receive all"
    await waitFor(() => expect(receiveTransfer).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ line_id: 'l2', quantity: 2 }] })))
  })

  it('offers closing with a shortage once something has arrived, and shows the shortage afterwards', async () => {
    getTransfer.mockResolvedValue(transfer({ lines: transfer().lines.map((l) => (l.id === 'l1' ? { ...l, quantity_received: 3 } : l)) }))
    closeTransfer.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { unmount } = show()
    await screen.findByText('TR-00007')
    expect(screen.queryByRole('button', { name: 'Cancel transfer' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close with shortage' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Closing note'), 'One box damaged')
    await user.click(within(dialog).getByRole('button', { name: 'Close transfer' }))
    await waitFor(() => expect(closeTransfer).toHaveBeenCalledWith('t-1', 'One box damaged'))
    unmount()

    getTransfer.mockResolvedValue(transfer({ status: 'completed', closed_note: 'One box damaged', lines: transfer().lines.map((l) => (l.id === 'l1' ? { ...l, quantity_received: 7 } : { ...l, quantity_received: 2 })) }))
    show()
    await screen.findByText('TR-00007')
    expect(screen.getByRole('status')).toHaveTextContent('Closed with a shortage: 1 of 10 units sent did not arrive.')
    expect(screen.getByText('Short')).toBeInTheDocument()
    expect(screen.queryByLabelText('Closing note')).toBeNull()
  })

  it('is read-only for viewers', async () => {
    role = 'viewer'
    getTransfer.mockResolvedValue(transfer())
    show()
    expect(await screen.findByText(/read-only access/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'mock scanner' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel transfer' })).toBeNull()
  })
})
