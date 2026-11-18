import { pdfText } from '@/domain/report'

export interface LabelProduct {
  name: string
  sku: string | null
  barcode: string | null
  qr_code: string | null
  unit: string
}

/** The code a printed QR label carries: the product's QR value, otherwise its barcode, otherwise its SKU. */
export function labelCode(p: Pick<LabelProduct, 'qr_code' | 'barcode' | 'sku'>): string | null {
  return p.qr_code || p.barcode || p.sku || null
}

export async function qrSvg(text: string): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** A self-contained printable page with one label (50 x 30 mm): QR code, name, SKU and the code in text. */
export async function labelHtml(p: LabelProduct): Promise<string> {
  const code = labelCode(p)
  if (!code) throw new Error('Add a QR value, barcode or SKU to this product before printing a label.')
  const svg = await qrSvg(code)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(pdfText(p.name))} label</title>
<style>
@page { size: 50mm 30mm; margin: 0 }
body { margin: 0; font-family: system-ui, sans-serif; color: #000 }
.label { width: 50mm; height: 30mm; box-sizing: border-box; padding: 2mm; display: flex; gap: 2mm; align-items: center }
.qr { width: 24mm; height: 24mm; flex: none }
.qr svg { width: 100%; height: 100% }
.text { min-width: 0; font-size: 8pt; line-height: 1.25 }
.name { font-weight: 700; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical }
.code { font-family: ui-monospace, monospace; font-size: 7pt; word-break: break-all }
</style></head><body><div class="label"><div class="qr">${svg}</div><div class="text">
<div class="name">${escapeHtml(p.name)}</div>
${p.sku ? `<div>SKU ${escapeHtml(p.sku)}</div>` : ''}
<div class="code">${escapeHtml(code)}</div></div></div>
<script>window.onload = () => { window.print() }</script></body></html>`
}

/** Open the label in a new window and show the print dialog. */
export async function printLabel(p: LabelProduct): Promise<void> {
  const html = await labelHtml(p)
  const w = window.open('', '_blank', 'width=420,height=320')
  if (!w) throw new Error('The label window was blocked. Allow pop-ups for this site to print labels.')
  w.document.open()
  w.document.write(html)
  w.document.close()
}
