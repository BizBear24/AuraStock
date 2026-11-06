import { classifyCameraError, escapeLike, HidScannerBuffer, normalizeScan, ScanDeduper } from './scan'

describe('normalizeScan', () => {
  it('trims and strips control characters', () => {
    expect(normalizeScan('  4006381333931\r\n')).toEqual({ ok: true, code: '4006381333931' })
  })
  it('rejects empty and oversized scans', () => {
    expect(normalizeScan('  \n').ok).toBe(false)
    expect(normalizeScan('x'.repeat(513)).ok).toBe(false)
  })
})

describe('ScanDeduper', () => {
  it('blocks the same code inside the cooldown only', () => {
    const d = new ScanDeduper(1000)
    expect(d.accept('A', 0)).toBe(true)
    expect(d.accept('A', 500)).toBe(false)
    expect(d.accept('B', 600)).toBe(true)
    expect(d.accept('B', 1700)).toBe(true)
  })
  it('can be reset', () => {
    const d = new ScanDeduper(1000)
    d.accept('A', 0)
    d.reset()
    expect(d.accept('A', 10)).toBe(true)
  })
})

describe('HidScannerBuffer', () => {
  const type = (b: HidScannerBuffer, text: string, start: number, gap: number) => {
    let t = start
    for (const ch of text) {
      b.push(ch, t)
      t += gap
    }
    return b.push('Enter', t)
  }

  it('emits a fast burst ended by Enter', () => {
    expect(type(new HidScannerBuffer(), '5449000000996', 0, 10)).toBe('5449000000996')
  })
  it('ignores slow human typing', () => {
    expect(type(new HidScannerBuffer(), '5449000000996', 0, 200)).toBeNull()
  })
  it('ignores short bursts and modifier keys', () => {
    const b = new HidScannerBuffer()
    b.push('Shift', 0)
    expect(type(b, 'ab', 0, 5)).toBeNull()
  })
  it('recovers after a stray slow key', () => {
    const b = new HidScannerBuffer()
    b.push('x', 0)
    expect(type(b, '12345', 1000, 10)).toBe('12345')
  })
})

describe('classifyCameraError', () => {
  it('maps browser error names', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('permission-denied')
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('no-camera')
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('in-use')
    expect(classifyCameraError(new TypeError('x'))).toBe('unsupported')
    expect(classifyCameraError('boom')).toBe('unknown')
  })
})

describe('escapeLike', () => {
  it('escapes wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
  })
})
