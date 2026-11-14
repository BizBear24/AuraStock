import { PageHeader } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { ExportPanel } from './ExportPanel'
import { ImportWizard } from './ImportWizard'

export function DataPage() {
  const { inventory, role } = useWorkspace()
  if (!inventory) {
    return (
      <>
        <PageHeader title="Import & export" />
        <EmptyState title="No inventory selected" description="Create an inventory first." />
      </>
    )
  }
  return (
    <>
      <PageHeader title="Import & export" description={`${inventory.name} · CSV and Excel`} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ExportPanel />
        <ImportWizard canImport={can(role, 'product.write')} />
      </div>
    </>
  )
}
