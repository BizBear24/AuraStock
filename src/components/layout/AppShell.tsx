import { ArrowLeftRight, Bell, Boxes, Calculator, ChevronDown, DatabaseBackup, FileSpreadsheet, FileText, History, LayoutDashboard, LogOut, MoreHorizontal, Package, ScanLine, Settings, Truck, User, Users, Warehouse } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { can } from '@/domain/permissions'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useOffline } from '@/offline/OfflineProvider'
import { SyncBadge, SyncBanner } from '@/offline/SyncStatus'
import { useRealtime, type LiveStatus } from '@/features/realtime/useRealtime'
import { InvitationsList } from '@/features/team/InvitationsList'
import { useAutoBackup } from '@/features/backups/useAutoBackup'
import { useInventoryCache } from '@/offline/useInventoryCache'
import { cn } from '@/lib/cn'
import { useAuth } from '@/features/auth/AuthProvider'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
  /** Only shown to members who can use it. */
  adminOnly?: boolean
}

/**
 * Navigation is grouped so the everyday work (products, scanning, stock) is always one tap away, and the
 * occasional tools and administration stay out of the way until needed.
 */
export const NAV_GROUPS: { id: 'core' | 'tools' | 'admin'; label: string; items: NavItem[] }[] = [
  {
    id: 'core',
    label: 'Everyday',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/products', label: 'Products', icon: Package },
      { to: '/scan', label: 'Scan', icon: ScanLine },
      { to: '/movements', label: 'Movements', icon: ArrowLeftRight },
      { to: '/transfers', label: 'Transfers', icon: Truck },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      { to: '/notifications', label: 'Alerts', icon: Bell },
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/data', label: 'Import & export', icon: FileSpreadsheet },
      { to: '/calculator', label: 'Calculator', icon: Calculator },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { to: '/inventories', label: 'Inventories', icon: Warehouse },
      { to: '/team', label: 'Team', icon: Users },
      { to: '/activity', label: 'Activity', icon: History, adminOnly: true },
      { to: '/backups', label: 'Backups', icon: DatabaseBackup, adminOnly: true },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/** Sections with a place in the mobile bottom bar; everything else lives under More. */
const MOBILE_PRIMARY: string[] = ['/', '/products', '/scan', '/movements']

const ADMIN_OPEN_KEY = 'aurastock.nav.admin'

function readAdminOpen(): boolean {
  try {
    return localStorage.getItem(ADMIN_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn('flex h-9 items-center gap-2 rounded-md px-3 text-sm', isActive ? 'bg-surface font-semibold text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg')
      }
    >
      <Icon className="h-4 w-4" aria-hidden /> {item.label}
    </NavLink>
  )
}

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const location = useLocation()
  const inAdmin = NAV_GROUPS[2]!.items.some((i) => location.pathname.startsWith(i.to))
  const [adminOpen, setAdminOpen] = useState(readAdminOpen)
  const open = adminOpen || inAdmin
  const toggle = () => {
    const next = !adminOpen
    setAdminOpen(next)
    try {
      localStorage.setItem(ADMIN_OPEN_KEY, next ? '1' : '0')
    } catch {
      // preference only
    }
  }
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => !i.adminOnly || isAdmin)
        if (group.id === 'admin') {
          return (
            <div key={group.id} className="mt-3">
              <button
                type="button"
                aria-expanded={open}
                onClick={toggle}
                className="flex h-7 w-full items-center justify-between rounded-md px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-2 hover:text-fg"
              >
                {group.label}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open ? 'rotate-180' : '')} aria-hidden />
              </button>
              {open && <div className="space-y-0.5">{items.map((i) => <SidebarLink key={i.to} item={i} />)}</div>}
            </div>
          )
        }
        return (
          <div key={group.id} className={group.id === 'core' ? '' : 'mt-3'}>
            {group.id !== 'core' && <p className="flex h-7 items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-2">{group.label}</p>}
            <div className="space-y-0.5">{items.map((i) => <SidebarLink key={i.to} item={i} />)}</div>
          </div>
        )
      })}
    </nav>
  )
}

function LiveDot({ status }: { status: LiveStatus }) {
  const label = status === 'live' ? 'Live updates on' : status === 'connecting' ? 'Connecting to live updates' : 'Live updates paused'
  return (
    <span title={label} role="img" aria-label={label} className="hidden h-8 shrink-0 items-center gap-1.5 text-xs text-fg-2 sm:flex">
      <span aria-hidden className={cn('h-2 w-2 rounded-full', status === 'live' ? 'bg-ok' : 'bg-fg-2')} />
      {status === 'live' ? 'Live' : ''}
    </span>
  )
}

function WorkspaceSwitcher() {
  const { memberships, organization, inventories, inventory, setOrganizationId, setInventoryId } = useWorkspace()
  const selectClass = 'h-8 min-w-0 flex-1 rounded-md border border-line bg-bg-2 px-2 text-[13px] text-fg'
  return (
    <div className="flex min-w-0 items-center gap-2">
      <select
        aria-label="Organization"
        className={selectClass}
        value={organization.organizationId}
        onChange={(e) => setOrganizationId(e.target.value)}
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName}
          </option>
        ))}
      </select>
      <select
        aria-label="Inventory"
        className={selectClass}
        value={inventory?.id ?? ''}
        onChange={(e) => setInventoryId(e.target.value)}
        disabled={inventories.length === 0}
      >
        {inventories.length === 0 && <option value="">No inventories</option>}
        {inventories.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}{i.is_demo ? ' (demo)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AppShell() {
  const { user, signOut } = useAuth()
  const { organization, inventory, role, setOrganizationId } = useWorkspace()
  const { snapshot } = useOffline()
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const unsynced = snapshot.pending + snapshot.failed + snapshot.conflicts
  useInventoryCache(inventory?.id)
  const live = useRealtime(organization.organizationId, inventory?.id)
  useAutoBackup(organization.organizationId, organization.organizationName, role, snapshot.online)
  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-bg-2 md:flex">
        <div className="flex h-12 items-center gap-2 border-b border-line px-4 font-semibold tracking-tight">
          <Boxes className="h-4 w-4" aria-hidden /> AuraStock
        </div>
        <Sidebar isAdmin={can(role, 'org.manage')} />
        <div className="border-t border-line p-2">
          <NavLink to="/profile" className="block truncate rounded-md px-3 pb-1 text-xs text-fg-2 hover:text-fg" title="Your profile">
            {user?.email}
          </NavLink>
          <button
            type="button"
            onClick={() => (unsynced > 0 ? setConfirmSignOut(true) : void signOut())}
            className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm text-fg-2 hover:bg-surface hover:text-fg"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg-2 px-3 md:px-6">
          <span className="font-semibold tracking-tight md:hidden">AuraStock</span>
          <div className="min-w-0 flex-1 md:max-w-xl">
            <WorkspaceSwitcher />
          </div>
          <LiveDot status={live} />
          <SyncBadge />
          <NotificationBell />
          <NavLink to="/profile" aria-label="Profile" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-surface md:hidden">
            <User className="h-4 w-4" aria-hidden />
          </NavLink>
        </header>
        <SyncBanner />
        <InvitationsList compact onAccepted={setOrganizationId} />
        {inventory?.is_demo && (
          <div role="status" className="flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-sm md:px-6">
            <span className="font-semibold text-info">Demo data.</span>
            <span>You are viewing sample data. Nothing here is real.</span>
            <NavLink to="/inventories" className="ml-auto shrink-0 underline">
              Manage
            </NavLink>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto p-3 pb-20 md:p-6 md:pb-6">
          <Outlet />
        </main>
        <ConfirmDialog
          open={confirmSignOut}
          onOpenChange={setConfirmSignOut}
          title="Sign out with unsynced changes?"
          description={`${unsynced} change${unsynced === 1 ? ' is' : 's are'} still saved only on this device. They stay here and will be sent the next time you sign in on this device. Until then, other devices will not see them.`}
          confirmLabel="Sign out anyway"
          destructive
          onConfirm={() => void signOut()}
        />
        <nav
          aria-label="Primary mobile"
          className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-bg-2 pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to)).map(({ to, label, icon: Icon, end }) =>
            to === '/scan' ? (
              <NavLink key={to} to={to} aria-label="Scan" className="flex h-14 items-center justify-center">
                <span className="-mt-5 flex h-14 w-14 flex-col items-center justify-center rounded-full border border-fg bg-fg text-bg">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
              </NavLink>
            ) : (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'font-semibold text-fg' : 'text-fg-2')
                }
              >
                <Icon className="h-5 w-5" aria-hidden /> {label}
              </NavLink>
            ),
          )}
          <NavLink
            to="/more"
            className={({ isActive }) =>
              cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'font-semibold text-fg' : 'text-fg-2')
            }
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden /> More
          </NavLink>
        </nav>
      </div>
    </div>
  )
}
