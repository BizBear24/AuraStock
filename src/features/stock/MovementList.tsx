import { Link } from 'react-router-dom'
import { StatusBadge, type Status } from '@/components/ui/status-badge'
import { formatQty, MOVEMENT_LABEL, type MovementType } from '@/domain/stock'
import type { Movement } from './api'

const TONE: Record<MovementType, Status> = { in: 'ok', out: 'neutral', adjustment: 'info', correction: 'info' }

function who(m: Movement): string {
  return m.author?.full_name ?? m.author?.email ?? 'Unknown user'
}

export function MovementList({ rows, showProduct = true }: { rows: Movement[]; showProduct?: boolean }) {
  return (
    <>
      <table className="hidden w-full text-left md:table">
        <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-fg-2">
          <tr>
            <th className="px-3 py-2">When</th>
            {showProduct && <th className="px-3 py-2">Product</th>}
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2 text-right">Change</th>
            <th className="px-3 py-2 text-right">Balance</th>
            <th className="px-3 py-2">Reference / note</th>
            <th className="px-3 py-2">User</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="num whitespace-nowrap px-3 py-2 text-fg-2">{new Date(m.created_at).toLocaleString()}</td>
              {showProduct && (
                <td className="px-3 py-2">
                  <Link to={`/products/${m.product_id}`} className="font-medium hover:underline">
                    {m.product?.name ?? 'Unknown product'}
                  </Link>
                </td>
              )}
              <td className="px-3 py-2">
                <StatusBadge status={TONE[m.movement_type]}>{MOVEMENT_LABEL[m.movement_type]}</StatusBadge>
              </td>
              <td className={`num px-3 py-2 text-right font-semibold ${m.delta > 0 ? 'text-ok' : ''}`}>
                {m.delta > 0 ? '+' : ''}
                {formatQty(m.delta)}
              </td>
              <td className="num px-3 py-2 text-right">{formatQty(m.quantity_after)}</td>
              <td className="px-3 py-2 text-fg-2">{[m.reference && `#${m.reference}`, m.note].filter(Boolean).join(' · ') || '—'}</td>
              <td className="px-3 py-2 text-fg-2">{who(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((m) => (
          <li key={m.id} className="px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {showProduct && (
                  <Link to={`/products/${m.product_id}`} className="block truncate font-medium">
                    {m.product?.name ?? 'Unknown product'}
                  </Link>
                )}
                <StatusBadge status={TONE[m.movement_type]}>{MOVEMENT_LABEL[m.movement_type]}</StatusBadge>
              </div>
              <p className={`num text-right font-semibold ${m.delta > 0 ? 'text-ok' : ''}`}>
                {m.delta > 0 ? '+' : ''}
                {formatQty(m.delta)}
                <span className="block text-xs font-normal text-fg-2">→ {formatQty(m.quantity_after)}</span>
              </p>
            </div>
            <p className="num mt-1 text-xs text-fg-2">
              {new Date(m.created_at).toLocaleString()} · {who(m)}
            </p>
            {(m.reference || m.note) && <p className="mt-0.5 text-xs text-fg-2">{[m.reference && `#${m.reference}`, m.note].filter(Boolean).join(' · ')}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}
