import { useEffect, useRef } from 'react'
import { HidScannerBuffer } from '@/domain/scan'

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Listens for keyboard-wedge scanners anywhere on the page. Fast bursts ending in Enter are reported;
 * normal typing is ignored. Events from form fields are skipped unless the field opts in with data-scan-input.
 */
export function useHidScanner(onScan: (code: string) => void, enabled = true): void {
  const handler = useRef(onScan)
  useEffect(() => {
    handler.current = onScan
  }, [onScan])

  useEffect(() => {
    if (!enabled) return
    const buffer = new HidScannerBuffer()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditable(e.target) && !(e.target as HTMLElement).hasAttribute('data-scan-input')) return
      const code = buffer.push(e.key, performance.now())
      if (code) {
        e.preventDefault()
        handler.current(code)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
