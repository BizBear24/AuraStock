import { normalizeScan, scanUrl, unwrapScanUrl } from '@/domain/scan'
import { labelCode, labelHtml } from './label'
import { isNfcSupported, nfcErrorMessage, parseReading, readNfcTag, recordToCode, writeNfcTag } from './nfc'

const view = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  return new DataView(bytes.buffer)
}

describe('scan links', () => {
  it('builds and unwraps AuraStock scan links', () => {
    const url = scanUrl('https://aurastock-rosy.vercel.app/', 'R-5 & co')
    expect(url).toBe('https://aurastock-rosy.vercel.app/scan?code=R-5%20%26%20co')
    expect(unwrapScanUrl(url)).toBe('R-5 & co')
    expect(unwrapScanUrl('https://example.com/other?code=x')).toBe('https://example.com/other?code=x')
    expect(unwrapScanUrl('8901234567890')).toBe('8901234567890')
  })
  it('lets every scanner read label and tag links as plain codes', () => {
    expect(normalizeScan('https://aurastock-rosy.vercel.app/scan?code=8901234567890\n')).toEqual({ ok: true, code: '8901234567890' })
  })
})

describe('NDEF records', () => {
  it('reads text records and AuraStock links, ignoring others', () => {
    expect(recordToCode({ recordType: 'text', encoding: 'utf-8', data: view('  R-5 ') })).toBe('R-5')
    expect(recordToCode({ recordType: 'url', data: view('https://app.test/scan?code=890') })).toBe('890')
    expect(recordToCode({ recordType: 'url', data: view('https://example.com') })).toBeNull()
    expect(recordToCode({ recordType: 'mime', data: view('x') })).toBeNull()
    expect(recordToCode({ recordType: 'text', data: null })).toBeNull()
  })
  it('collects unique codes and the serial number', () => {
    const r = parseReading({
      serialNumber: '04:a2:3f:1c',
      message: { records: [{ recordType: 'url', data: view('https://app.test/scan?code=R-5') }, { recordType: 'text', data: view('R-5') }] },
    })
    expect(r).toEqual({ serial: '04:a2:3f:1c', codes: ['R-5'] })
    expect(parseReading({ message: { records: [] } })).toEqual({ serial: null, codes: [] })
  })
})

describe('Web NFC wrapper', () => {
  class FakeReader extends EventTarget {
    static last: FakeReader | null = null
    written: unknown = null
    constructor() {
      super()
      FakeReader.last = this
    }
    async scan() {}
    async write(message: unknown) {
      this.written = message
    }
  }
  const win = (withNfc: boolean) => ({ isSecureContext: true, ...(withNfc ? { NDEFReader: FakeReader } : {}) }) as unknown as Window

  it('detects support honestly', () => {
    expect(isNfcSupported(win(false))).toBe(false)
    expect(isNfcSupported(win(true))).toBe(true)
    expect(isNfcSupported({ isSecureContext: false, NDEFReader: FakeReader } as unknown as Window)).toBe(false)
  })

  it('resolves with the first tag that is tapped', async () => {
    const pending = readNfcTag(new AbortController().signal, win(true))
    const event = Object.assign(new Event('reading'), { serialNumber: '04:aa', message: { records: [{ recordType: 'text', data: view('X-1') }] } })
    FakeReader.last!.dispatchEvent(event)
    expect(await pending).toEqual({ serial: '04:aa', codes: ['X-1'] })
  })

  it('can be cancelled', async () => {
    const ctrl = new AbortController()
    const pending = readNfcTag(ctrl.signal, win(true))
    ctrl.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses on unsupported devices instead of pretending', async () => {
    await expect(readNfcTag(new AbortController().signal, win(false))).rejects.toThrow(/Chrome on Android/)
    await expect(writeNfcTag('x', 'y', new AbortController().signal, win(false))).rejects.toThrow(/Chrome on Android/)
  })

  it('writes a scan link and the plain code', async () => {
    await writeNfcTag('R-5', 'https://app.test/scan?code=R-5', new AbortController().signal, win(true))
    expect(FakeReader.last!.written).toEqual({ records: [{ recordType: 'url', data: 'https://app.test/scan?code=R-5' }, { recordType: 'text', data: 'R-5' }] })
  })

  it('explains NFC errors', () => {
    expect(nfcErrorMessage({ name: 'NotAllowedError' })).toMatch(/permission was denied/)
    expect(nfcErrorMessage({ name: 'NetworkError' })).toMatch(/moved away/)
  })
})

describe('QR labels', () => {
  it('picks the best code for a label', () => {
    expect(labelCode({ qr_code: 'Q', barcode: 'B', sku: 'S' })).toBe('Q')
    expect(labelCode({ qr_code: null, barcode: 'B', sku: 'S' })).toBe('B')
    expect(labelCode({ qr_code: null, barcode: null, sku: 'S' })).toBe('S')
    expect(labelCode({ qr_code: null, barcode: null, sku: null })).toBeNull()
  })
  it('renders a printable label with a real QR code and escaped text', async () => {
    const html = await labelHtml({ name: 'Rice <5kg> & "basmati"', sku: 'R-5', barcode: '8901234567890', qr_code: null, unit: 'bag' })
    expect(html).toContain('<svg')
    expect(html).toContain('Rice &lt;5kg&gt; &amp; &quot;basmati&quot;')
    expect(html).toContain('8901234567890')
    expect(html).toContain('@page { size: 50mm 30mm')
  })
  it('asks for a code first', async () => {
    await expect(labelHtml({ name: 'X', sku: null, barcode: null, qr_code: null, unit: 'pcs' })).rejects.toThrow(/Add a QR value, barcode or SKU/)
  })
})
