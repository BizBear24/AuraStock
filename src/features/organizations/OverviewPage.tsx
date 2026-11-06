import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { useWorkspace } from './WorkspaceProvider'

/** Phase 1 landing page. The operational dashboard (real stock metrics) arrives with products in Phase 2. */
export function OverviewPage() {
  const { organization, role, inventory } = useWorkspace()
  return (
    <>
      <PageHeader title="Dashboard" description={`${organization.organizationName}${inventory ? ` · ${inventory.name}` : ''}`} />
      {inventory ? (
        <Panel className="p-4">
          <p className="text-sm text-fg-2">
            Products and stock metrics will appear here once product management ships. Your role is <b className="text-fg">{role}</b>.
          </p>
        </Panel>
      ) : (
        <EmptyState
          title="Create your first inventory"
          description="An inventory holds the products you track."
          action={
            can(role, 'inventory.manage') ? (
              <Button asChild variant="primary">
                <Link to="/inventories">Create inventory</Link>
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  )
}
