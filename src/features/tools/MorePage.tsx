import { Bell, Calculator, CloudOff, FileSpreadsheet, FileText, User, Warehouse } from 'lucide-react'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Panel } from '@/components/ui/panel'

interface Item {
  to: string
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}

const ITEMS: Item[] = [
  { to: '/notifications', label: 'Alerts', description: 'Low stock, out of stock and expiry alerts', icon: Bell },
  { to: '/data', label: 'Import & export', description: 'CSV and Excel files', icon: FileSpreadsheet },
  { to: '/reports', label: 'Reports', description: 'PDF inventory, stock and movement reports', icon: FileText },
  { to: '/calculator', label: 'Calculator', description: 'Quick arithmetic for counts', icon: Calculator },
  { to: '/sync', label: 'Sync', description: 'Changes waiting to be sent to the server', icon: CloudOff },
  { to: '/inventories', label: 'Inventories', description: 'Create and switch inventories', icon: Warehouse },
  { to: '/profile', label: 'Profile', description: 'Your account and sign out', icon: User },
]

/** Everything that does not fit the mobile bottom bar. */
export function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <Panel className="overflow-hidden">
        <ul className="divide-y divide-line">
          {ITEMS.map(({ to, label, description, icon: Icon }) => (
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
    </>
  )
}
