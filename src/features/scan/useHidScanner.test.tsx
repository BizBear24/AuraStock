import { render } from '@testing-library/react'
import { useHidScanner } from './useHidScanner'

function Harness({ onScan }: { onScan: (code: string) => void }) {
  useHidScanner(onScan)
  return (
    <div>
      <input aria-label="other" />
      <input aria-label="scan" data-scan-input />
    </div>
  )
}

function burst(target: EventTarget, text: string, gapMs: number) {
  let now = 1000
  const spy = vi.spyOn(performance, 'now')
  for (const key of [...text, 'Enter']) {
    spy.mockReturnValue(now)
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    now += gapMs
  }
  spy.mockRestore()
}

describe('useHidScanner', () => {
  it('reports a fast burst typed outside form fields', () => {
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)
    burst(document.body, '4006381333931', 10)
    expect(onScan).toHaveBeenCalledWith('4006381333931')
  })

  it('ignores slow typing', () => {
    const onScan = vi.fn()
    render(<Harness onScan={onScan} />)
    burst(document.body, '4006381333931', 300)
    expect(onScan).not.toHaveBeenCalled()
  })

  it('ignores form fields unless they opt in', () => {
    const onScan = vi.fn()
    const { getByLabelText } = render(<Harness onScan={onScan} />)
    burst(getByLabelText('other'), '4006381333931', 10)
    expect(onScan).not.toHaveBeenCalled()
    burst(getByLabelText('scan'), '4006381333931', 10)
    expect(onScan).toHaveBeenCalledWith('4006381333931')
  })
})
