import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Nfc, Printer } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { scanUrl } from '@/domain/scan'
import { errorMessage } from '@/lib/supabase'
import { setProductNfcTag, type Product } from '@/features/products/api'
import { labelCode, printLabel } from './label'
import { isNfcSupported, NFC_UNSUPPORTED_MESSAGE, nfcErrorMessage, readNfcTag, writeNfcTag } from './nfc'

type Waiting = 'link' | 'write' | null

/** NFC tag link and printable QR label for one product. */
export function ProductTagPanel({ product, canWrite, online }: { product: Product; canWrite: boolean; online: boolean }) {
  const queryClient = useQueryClient()
  const supported = isNfcSupported()
  const abort = useRef<AbortController | null>(null)
  const [waiting, setWaiting] = useState<Waiting>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const code = labelCode(product)

  const refresh = () => Promise.all(['product', 'products'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))

  const run = async (kind: Exclude<Waiting, null>) => {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setWaiting(kind)
    setMessage(null)
    try {
      if (kind === 'link') {
        const tag = await readNfcTag(ctrl.signal)
        if (!tag.serial) throw new Error('This tag does not report a serial number. Use “Write to tag” instead.')
        await setProductNfcTag(product.id, tag.serial)
        await refresh()
        setMessage({ tone: 'ok', text: `Tag ${tag.serial} is now linked to ${product.name}.` })
      } else {
        if (!code) throw new Error('Add a QR value, barcode or SKU to this product first.')
        await writeNfcTag(code, scanUrl(window.location.origin, code), ctrl.signal)
        setMessage({ tone: 'ok', text: 'Written. Tapping this tag now opens the product in AuraStock.' })
      }
    } catch (e) {
      const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : ''
      if (name !== 'AbortError') setMessage({ tone: 'error', text: name ? nfcErrorMessage(e) : errorMessage(e) })
    } finally {
      setWaiting(null)
    }
  }

  const unlink = useMutation({
    mutationFn: () => setProductNfcTag(product.id, null),
    onSuccess: async () => {
      setMessage({ tone: 'ok', text: 'Tag unlinked.' })
      await refresh()
    },
    onError: (e) => setMessage({ tone: 'error', text: errorMessage(e) }),
  })

  const print = useMutation({
    mutationFn: () => printLabel(product),
    onError: (e) => setMessage({ tone: 'error', text: errorMessage(e) }),
  })

  return (
    <Panel className="p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <Nfc className="h-4 w-4 text-fg-2" aria-hidden /> Tags and labels
      </h2>
      <p className="mb-3 text-sm text-fg-2">
        NFC tag: {product.nfc_uid ? <b className="num text-fg">{product.nfc_uid}</b> : 'none linked'}
        {code ? (
          <>
            {' '}· Label code: <span className="num text-fg">{code}</span>
          </>
        ) : null}
      </p>

      {waiting && (
        <div role="status" className="mb-3 flex items-center justify-between gap-2 rounded-md border border-info px-3 py-2 text-sm">
          <span>Hold the tag against the back of the phone…</span>
          <Button size="sm" onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button loading={print.isPending} disabled={!code} onClick={() => print.mutate()}>
          <Printer className="h-4 w-4" aria-hidden /> Print QR label
        </Button>
        {supported && canWrite && (
          <>
            <Button disabled={waiting !== null || !online} onClick={() => void run('link')}>
              Link a tag
            </Button>
            <Button disabled={waiting !== null || !code} onClick={() => void run('write')}>
              Write to tag
            </Button>
            {product.nfc_uid && (
              <Button variant="ghost" loading={unlink.isPending} disabled={!online} onClick={() => unlink.mutate()}>
                Unlink tag
              </Button>
            )}
          </>
        )}
      </div>
      {!code && <p className="mt-2 text-xs text-fg-2">Add a QR value, barcode or SKU to print a label or write a tag.</p>}
      {!supported && <p className="mt-2 text-xs text-fg-2">{NFC_UNSUPPORTED_MESSAGE}</p>}
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.tone === 'error' ? 'text-crit' : 'text-ok'}`}>
          {message.text}
        </p>
      )}
    </Panel>
  )
}
