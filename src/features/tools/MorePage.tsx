import { Bell, Calculator, CloudOff, DatabaseBackup, FileSpreadsheet, FileText, History, Settings, Truck, User, Users, Warehouse } from 'lucide-react'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Panel } from '@/components/ui/panel'
import { can } from '@/domain/permissions'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'

interface Item {
  to: string
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  adminOnly?: boolean
}

/** Same order as the desktop sidebar: everyday work first, then tools, then administration. */
const SECTIONS: { label: string; items: Item[] }[] = [
  {
    label: 'Everyday',
    items: [{ to: '/transfers', label: 'Transfers', description: 'Scan stock out and in between inventories', icon: Truck }],
  },
  {
    label: 'Tools',
    items: [
      { to: '/notifications', label: 'Alerts', description: 'Low stock, out of stock and expiry alerts', icon: Bell },
      { to: '/reports', label: 'Reports', description: 'PDF reports and stock analysis', icon: FileText },
      { to: '/data', label: 'Import & export', description: 'CSV and Excel files', icon: FileSpreadsheet },
      { to: '/calculator', label: 'Calculator', description: 'Quick arithmetic for counts', icon: Calculator },
      { to: '/sync', label: 'Sync', description: 'Changes waiting to be sent to the server', icon: CloudOff },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/inventories', label: 'Inventories', description: 'Create and switch inventories, demo data', icon: Warehouse },
      { to: '/team', label: 'Team', description: 'Members, invitations, roles and permissions', icon: Users },
      { to: '/activity', label: 'Activity', description: 'Who did what', icon: History, adminOnly: true },
      { to: '/backups', label: 'Backups', description: 'Verified backups, schedule, restore, Google Drive', icon: DatabaseBackup, adminOnly: true },
      { to: '/settings', label: 'Settings', description: 'Rename, create or delete organizations', icon: Settings },
      { to: '/profile', label: 'Profile', description: 'Your account and sign out', icon: User },
    ],
  },
]

/** Everything that does not fit the mobile bottom bar. */
export function MorePage() {
  const { role } = useWorkspace()
  const isAdmin = can(role, 'org.manage')
  return (
    <>
      <PageHeader title="More" />
      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <section key={section.label} aria-label={section.label}>
            <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-2">{section.label}</h2>
            <Panel className="overflow-hidden">
              <ul className="divide-y divide-line">
                {section.items
                  .filter((i) => !i.adminOnly || isAdmin)
                  .map(({ to, label, description, icon: Icon }) => (
                    <li key={to}>
                      <Link to={to} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
                        <Icon className="h-5 w-5 shrink-0 text-fg-2" />
                        <span className="min-w-0">
                          <span className="block font-medium">{label}</span>
                          <span className="block truncate text-sm text-fg-2">{description}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Panel>
          </section>
        ))}
      </div>
    </>
  )
}
