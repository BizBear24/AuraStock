import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Status = 'ok' | 'warn' | 'crit' | 'info' | 'neutral'

const TONE: Record<Status, string> = {
  ok: 'text-ok border-ok',
  warn: 'text-warn border-warn',
  crit: 'text-crit border-crit',
  info: 'text-info border-info',
  neutral: 'text-fg-2 border-line',
}

export function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        TONE[status],
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}
