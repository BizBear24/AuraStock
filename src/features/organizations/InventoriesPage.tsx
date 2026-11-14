import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { organizationSchema } from '@/features/auth/schemas'
import type { z } from 'zod'
import { createInventory } from './api'
import { DemoDataPanel } from './DemoDataPanel'
import { useWorkspace } from './WorkspaceProvider'

type Values = z.infer<typeof organizationSchema>

export function InventoriesPage() {
  const { user } = useAuth()
  const { organization, role, inventories, inventory, setInventoryId } = useWorkspace()
  const queryClient = useQueryClient()
  const canManage = can(role, 'inventory.manage')
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(organizationSchema) })

  const create = useMutation({
    mutationFn: (v: Values) =>
      createInventory({ organizationId: organization.organizationId, name: v.name, userId: user!.id }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['inventories', organization.organizationId] })
      setInventoryId(created.id)
      reset()
    },
  })

  return (
    <>
      <PageHeader title="Inventories" description={`${organization.organizationName} · your role: ${role}`} />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Panel>
          {inventories.length === 0 ? (
            <EmptyState title="No inventories yet" description="Create an inventory to start tracking products." />
          ) : (
            <ul className="divide-y divide-line">
              {inventories.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {i.name} {i.is_demo && <StatusBadge status="info">Demo</StatusBadge>}
                    </p>
                    <p className="num text-xs text-fg-2">Created {new Date(i.created_at).toLocaleDateString()}</p>
                  </div>
                  {i.id === inventory?.id ? (
                    <StatusBadge status="info">Active</StatusBadge>
                  ) : (
                    <Button size="sm" onClick={() => setInventoryId(i.id)}>
                      Switch
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-4">
        {canManage ? (
            <Panel className="h-fit p-4">
              <h2 className="mb-3 font-semibold">New inventory</h2>
              <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-3" noValidate>
                {create.isError && (
                  <p role="alert" className="text-sm text-crit">
                    {errorMessage(create.error)}
                  </p>
                )}
                <Field label="Name" error={errors.name?.message} {...register('name')} />
                <Button type="submit" variant="primary" loading={create.isPending}>
                  Create inventory
                </Button>
              </form>
            </Panel>
          ) : (
            <p className="text-sm text-fg-2">Only admins and owners can create inventories.</p>
          )}
          <DemoDataPanel />
        </div>
      </div>
    </>
  )
}
