import { useQuery } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { unreadCount } from './api'

/** Top-bar bell with the number of unread alerts. Polls once a minute; also refreshed after stock changes. */
export function NotificationBell() {
  const { organization } = useWorkspace()
  const query = useQuery({
    queryKey: ['notifications', organization.organizationId, 'unread-count'],
    queryFn: () => unreadCount(organization.organizationId),
    refetchInterval: 60_000,
    retry: false,
  })
  const count = query.data ?? 0
  return (
    <Link
      to="/notifications"
      aria-label={count > 0 ? `Alerts, ${count} unread` : 'Alerts'}
      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-surface hover:text-fg"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {count > 0 && (
        <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-crit px-1 text-center text-[10px] font-semibold leading-4 text-bg">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
