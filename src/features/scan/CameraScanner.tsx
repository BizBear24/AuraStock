import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { SwitchCamera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CAMERA_MESSAGE, classifyCameraError, type CameraFailure } from '@/domain/scan'

export interface CameraScan {
  text: string
  isQr: boolean
}

const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
]

type CameraState = { kind: 'starting' } | { kind: 'scanning' } | { kind: 'error'; failure: CameraFailure }

/**
 * Live camera decoder. Mount it to start the camera and unmount it to stop and release the device.
 * Reports every decoded frame; the caller is responsible for de-duplicating repeats.
 */
export function CameraScanner({ onScan }: { onScan: (scan: CameraScan) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const callback = useRef(onScan)
  const [state, setState] = useState<CameraState>({ kind: 'starting' })
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)

  useEffect(() => {
    callback.current = onScan
  }, [onScan])

  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ kind: 'error', failure: 'unsupported' })
        return
      }
      try {
        const hints = new Map<DecodeHintType, unknown>([
          [DecodeHintType.POSSIBLE_FORMATS, FORMATS],
          [DecodeHintType.TRY_HARDER, true],
        ])
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })
        const controls = await reader.decodeFromVideoDevice(deviceId, videoRef.current ?? undefined, (result) => {
          if (result) callback.current({ text: result.getText(), isQr: result.getBarcodeFormat() === BarcodeFormat.QR_CODE })
        })
        if (cancelled) {
          controls.stop()
          return
        }
        stop = () => controls.stop()
        setState({ kind: 'scanning' })
        // Device labels are only available after permission has been granted.
        const list = await BrowserMultiFormatReader.listVideoInputDevices()
        if (!cancelled) setDevices(list)
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', failure: classifyCameraError(e) })
      }
    }
    void start()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [deviceId])

  const switchCamera = () => {
    if (devices.length < 2) return
    const index = devices.findIndex((d) => d.deviceId === deviceId)
    const next = devices[(index + 1) % devices.length]
    if (next) {
      setState({ kind: 'starting' })
      setDeviceId(next.deviceId)
    }
  }

  if (state.kind === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-crit p-4 text-sm">
        <p className="font-medium text-crit">Camera unavailable</p>
        <p className="mt-1">{CAMERA_MESSAGE[state.failure]}</p>
        <Button className="mt-3" size="sm" onClick={() => { setState({ kind: 'starting' }); setDeviceId(undefined) }}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-black">
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Camera preview" />
      <div aria-hidden className="pointer-events-none absolute inset-x-[12%] top-1/2 h-0.5 -translate-y-1/2 bg-white/70" />
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-between bg-black/60 px-3 py-2 text-xs text-white">
        <span role="status">{state.kind === 'starting' ? 'Starting camera…' : 'Point the camera at a barcode or QR code'}</span>
        {devices.length > 1 && (
          <Button size="sm" variant="secondary" onClick={switchCamera} aria-label="Switch camera">
            <SwitchCamera className="h-4 w-4" aria-hidden /> Switch
          </Button>
        )}
      </div>
    </div>
  )
}
