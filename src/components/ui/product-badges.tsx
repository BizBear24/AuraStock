import { expiryState, type StockState } from '@/domain/product-status'
import { StatusBadge } from './status-badge'

export function StockBadge({ state }: { state: StockState }) {
  if (state === 'out') return <StatusBadge status="crit">Out of stock</StatusBadge>
  if (state === 'low') return <StatusBadge status="warn">Low stock</StatusBadge>
  return <StatusBadge status="ok">In stock</StatusBadge>
}

export function ExpiryBadge({ expiresOn }: { expiresOn: string | null }) {
  const state = expiryState(expiresOn)
  if (state === 'expired') return <StatusBadge status="crit">Expired</StatusBadge>
  if (state === 'expiring') return <StatusBadge status="warn">Expiring</StatusBadge>
  return null
}
