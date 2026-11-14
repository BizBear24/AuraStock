import { cn } from '@/lib/cn'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Accessible name; pair with visible text or aria-labelledby when the label is rendered separately. */
  label: string
  disabled?: boolean
  busy?: boolean
}

/** Accessible on/off toggle. Flat, bordered, no animation beyond the thumb position. */
export function Switch({ checked, onCheckedChange, label, disabled, busy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-ok bg-ok' : 'border-line bg-surface',
      )}
    >
      <span
        aria-hidden
        className={cn('inline-block h-4 w-4 rounded-full border border-line bg-bg-2 transition-transform', checked ? 'translate-x-6' : 'translate-x-1')}
      />
    </button>
  )
}
