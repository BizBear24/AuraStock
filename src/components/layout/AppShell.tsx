import { Boxes, LayoutDashboard, LogOut, User, Warehouse } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { useAuth } from '@/features/auth/AuthProvider'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventories', label: 'Inventories', icon: Warehouse, end: false },
  { to: '/profile', label: 'Profile', icon: User, end: false },
] as const

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
            {i.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AppShell() {
  const { user, signOut } = useAuth()
  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-bg-2 md:flex">
        <div className="flex h-12 items-center gap-2 border-b border-line px-4 font-semibold tracking-tight">
          <Boxes className="h-4 w-4" aria-hidden /> AuraStock
        </div>
        <nav aria-label="Primary" className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-2 rounded-md px-3 text-sm',
                  isActive ? 'bg-surface font-semibold text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-2">
          <p className="truncate px-3 pb-1 text-xs text-fg-2">{user?.email}</p>
          <button
            type="button"
            onClick={() => void signOut()}
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
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-3 pb-20 md:p-6 md:pb-6">
          <Outlet />
        </main>
        <nav
          aria-label="Primary mobile"
          className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-line bg-bg-2 pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {NAV.map(({ to, label, icon: Icon, end }) => (
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
          ))}
        </nav>
      </div>
    </div>
  )
}
