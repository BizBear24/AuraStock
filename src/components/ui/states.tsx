import { AlertTriangle, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './button'

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-10 text-fg-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 p-10 text-center">
      <AlertTriangle className="h-5 w-5 text-crit" aria-hidden />
      <p className="max-w-sm text-sm">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line p-10 text-center">
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-sm text-fg-2">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
