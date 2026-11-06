let audio: AudioContext | null = null

/** Short confirmation beep and vibration. Silently does nothing where unsupported or blocked. */
export function scanFeedback(kind: 'ok' | 'error'): void {
  try {
    navigator.vibrate?.(kind === 'ok' ? 40 : [60, 40, 60])
  } catch {
    /* vibration unsupported */
  }
  try {
    audio ??= new AudioContext()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.frequency.value = kind === 'ok' ? 1040 : 220
    gain.gain.value = 0.08
    osc.connect(gain).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + (kind === 'ok' ? 0.09 : 0.22))
  } catch {
    /* audio unavailable until a user gesture, or unsupported */
  }
}
