import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Product } from '@/features/products/api'

let supported = true
const readNfcTag = vi.fn()
const writeNfcTag = vi.fn()
const setProductNfcTag = vi.fn()
const printLabel = vi.fn()

vi.mock('./nfc', async (orig) => {
  const real = await orig<typeof import('./nfc')>()
  return { ...real, isNfcSupported: () => supported, readNfcTag: (...a: unknown[]) => readNfcTag(...a), writeNfcTag: (...a: unknown[]) => writeNfcTag(...a) }
})
vi.mock('./label', async (orig) => ({ ...(await orig<typeof import('./label')>()), printLabel: (...a: unknown[]) => printLabel(...a) }))
vi.mock('@/features/products/api', () => ({ setProductNfcTag: (...a: unknown[]) => setProductNfcTag(...a) }))

const { ProductTagPanel } = await import('./ProductTagPanel')

const product = (over: Partial<Product> = {}) =>
  ({ id: 'p1', name: 'Rice', sku: 'R-5', barcode: '8901234567890', qr_code: null, unit: 'bag', nfc_uid: null, ...over }) as Product

const show = (p: Product, canWrite = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProductTagPanel product={p} canWrite={canWrite} online />
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  supported = true
})

describe('ProductTagPanel', () => {
  it('links the tapped tag by its serial number', async () => {
    readNfcTag.mockResolvedValue({ serial: '04:a2:3f:1c', codes: [] })
    setProductNfcTag.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show(product())
    await user.click(screen.getByRole('button', { name: 'Link a tag' }))
    await waitFor(() => expect(setProductNfcTag).toHaveBeenCalledWith('p1', '04:a2:3f:1c'))
    expect(await screen.findByText('Tag 04:a2:3f:1c is now linked to Rice.')).toBeInTheDocument()
  })

  it('writes a scan link plus the product code to a tag', async () => {
    writeNfcTag.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show(product())
    await user.click(screen.getByRole('button', { name: 'Write to tag' }))
    await waitFor(() => expect(writeNfcTag).toHaveBeenCalledWith('8901234567890', `${window.location.origin}/scan?code=8901234567890`, expect.any(AbortSignal)))
    expect(await screen.findByText(/Tapping this tag now opens the product/)).toBeInTheDocument()
  })

  it('explains NFC failures', async () => {
    readNfcTag.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    const user = userEvent.setup()
    show(product())
    await user.click(screen.getByRole('button', { name: 'Link a tag' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('NFC permission was denied')
  })

  it('unlinks a linked tag', async () => {
    setProductNfcTag.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show(product({ nfc_uid: '04:a2:3f:1c' }))
    expect(screen.getByText('04:a2:3f:1c')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unlink tag' }))
    await waitFor(() => expect(setProductNfcTag).toHaveBeenCalledWith('p1', null))
  })

  it('falls back to QR labels where NFC is not available, and never shows NFC buttons there', async () => {
    supported = false
    printLabel.mockResolvedValue(undefined)
    const user = userEvent.setup()
    show(product())
    expect(screen.queryByRole('button', { name: 'Link a tag' })).toBeNull()
    expect(screen.getByText(/NFC works in Chrome on Android/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Print QR label' }))
    expect(printLabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('needs a code for labels and tag writing, and write access for NFC changes', () => {
    show(product({ sku: null, barcode: null, qr_code: null }))
    expect(screen.getByRole('button', { name: 'Print QR label' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Write to tag' })).toBeDisabled()
    expect(screen.getByText(/Add a QR value, barcode or SKU/)).toBeInTheDocument()
  })

  it('hides NFC changes from read-only members', () => {
    show(product(), false)
    expect(screen.queryByRole('button', { name: 'Link a tag' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Print QR label' })).toBeEnabled()
  })
})
