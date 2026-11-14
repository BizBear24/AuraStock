import { Camera, CameraOff, Keyboard } from 'lucide-react'
import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { normalizeScan, ScanDeduper } from '@/domain/scan'
import { CameraScanner } from './CameraScanner'
import { scanFeedback } from './feedback'
import { useHidScanner } from './useHidScanner'

interface Props {
  /** Called with a cleaned, de-duplicated code from the camera, a USB scanner, or manual entry. */
  onCode: (code: string) => void
  disabled?: boolean
  /** Same code seen again inside this window is ignored, so a barcode held in view is not counted repeatedly. */
  cooldownMs?: number
}

/**
 * Continuous scanning input for batch workflows (dispatching and receiving transfers): the camera stays
 * on between scans, USB/Bluetooth scanners work anywhere on the page, and a manual field is always there.
 */
export function ScanIntake({ onCode, disabled, cooldownMs = 2500 }: Props) {
  const deduper = useRef(new ScanDeduper(cooldownMs))
  const [cameraOn, setCameraOn] = useState(false)
  const [manual, setManual] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)

  const handle = useCallback(
    (raw: string, viaManual = false) => {
      if (disabled) return
      const result = normalizeScan(raw)
      if (!result.ok) {
        scanFeedback('error')
        setInvalid(result.reason)
        return
      }
      // Typing the same code on purpose is always allowed; only repeated camera/scanner reads are suppressed.
      if (!viaManual && !deduper.current.accept(result.code, performance.now())) return
      setInvalid(null)
      onCode(result.code)
    },
    [disabled, onCode],
  )

  useHidScanner((code) => handle(code), !disabled)

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    handle(manual, true)
    setManual('')
  }

  return (
    <div className="space-y-3">
      {cameraOn ? (
        <>
          <CameraScanner onScan={(s) => handle(s.text)} />
          <Button onClick={() => setCameraOn(false)}>
            <CameraOff className="h-4 w-4" aria-hidden /> Stop camera
          </Button>
        </>
      ) : (
        <Button variant="primary" size="lg" className="w-full" disabled={disabled} onClick={() => setCameraOn(true)}>
          <Camera className="h-4 w-4" aria-hidden /> Scan with camera
        </Button>
      )}
      <form onSubmit={submitManual} className="flex gap-2">
        <Input
          data-scan-input
          aria-label="Enter a code manually"
          placeholder="Type or scan a barcode, QR value or SKU"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          autoComplete="off"
          disabled={disabled}
        />
        <Button type="submit" disabled={disabled || manual.trim() === ''}>
          <Keyboard className="h-4 w-4" aria-hidden /> Add
        </Button>
      </form>
      <p className="text-xs text-fg-2">USB and Bluetooth scanners work automatically. Scan the same item again to add another unit.</p>
      {invalid && (
        <p role="alert" className="text-sm text-crit">
          Invalid scan: {invalid}
        </p>
      )}
    </div>
  )
}
