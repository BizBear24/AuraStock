import { AlertTriangle, CheckCircle2, CloudOff, KeyRound, Loader2, UploadCloud } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import type { SyncSnapshot } from './engine'
import { useOffline } from './OfflineProvider'

export function describePhase(s: SyncSnapshot): { label: string; detail: string; tone: 'ok' | 'warn' | 'crit' | 'neutral'; icon: ReactNode } {
  const n = s.pending
  switch (s.phase) {
    case 'offline':
      return {
        label: 'Offline',
        detail: n > 0 ? `${n} change${n === 1 ? '' : 's'} saved on this device, waiting for a connection` : 'Working from data saved on this device',
        tone: 'warn',
        icon: <CloudOff className="h-4 w-4" aria-hidden />,
      }
    case 'syncing':
      return { label: 'Syncing', detail: `Sending ${n} change${n === 1 ? '' : 's'} to the server`, tone: 'neutral', icon: <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> }
    case 'auth-required':
      return { label: 'Sign in again', detail: 'Your session expired. Changes are kept on this device until you sign in.', tone: 'crit', icon: <KeyRound className="h-4 w-4" aria-hidden /> }
    case 'failed':
      return {
        label: 'Sync failed',
        detail: `${s.failed + s.conflicts} change${s.failed + s.conflicts === 1 ? '' : 's'} need attention`,
        tone: 'crit',
        icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      }
    case 'pending':
      return { label: 'Waiting to sync', detail: `${n} change${n === 1 ? '' : 's'} saved on this device, not yet confirmed by the server`, tone: 'warn', icon: <UploadCloud className="h-4 w-4" aria-hidden /> }
    case 'synced':
      return { label: 'Online', detail: s.lastSyncedAt ? 'All changes confirmed by the server' : 'Connected', tone: 'ok', icon: <CheckCircle2 className="h-4 w-4" aria-hidden /> }
  }
}

const TONE = { ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', neutral: 'text-fg-2' }

/** Compact connection / sync indicator for the top bar. Links to the queue. */
export function SyncBadge() {
  const { snapshot } = useOffline()
  const d = describePhase(snapshot)
  return (
    <Link
      to="/sync"
      title={d.detail}
      aria-label={`${d.label}. ${d.detail}`}
      className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2 text-xs font-medium hover:bg-surface', TONE[d.tone])}
    >
      {d.icon}
      <span className="hidden sm:inline">{d.label}</span>
      {snapshot.pending + snapshot.failed + snapshot.conflicts > 0 && <span className="num rounded-sm bg-surface px-1 text-fg">{snapshot.pending + snapshot.failed + snapshot.conflicts}</span>}
    </Link>
  )
}

/** Full-width notice shown only while offline or when something needs attention. */
export function SyncBanner() {
  const { snapshot } = useOffline()
  if (snapshot.phase === 'synced' || snapshot.phase === 'syncing' || snapshot.phase === 'pending') return null
  const d = describePhase(snapshot)
  return (
    <div role="status" className={cn('flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-sm md:px-6', TONE[d.tone])}>
      {d.icon}
      <span>
        <b>{d.label}.</b> <span className="text-fg">{d.detail}.</span>
      </span>
      <Link to="/sync" className="ml-auto shrink-0 text-fg underline">
        Details
      </Link>
    </div>
  )
}
