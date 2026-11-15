import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { organizationSchema } from '@/features/auth/schemas'
import { createOrganization } from '@/features/organizations/api'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { useOffline } from '@/offline/OfflineProvider'
import { deleteOrganization, renameOrganization } from './api'

type Values = z.infer<typeof organizationSchema>

export function SettingsPage() {
  const { organization, role, setOrganizationId } = useWorkspace()
  const { snapshot } = useOffline()
  const queryClient = useQueryClient()
  const orgId = organization.organizationId
  const canRename = can(role, 'org.manage')
  const canDelete = can(role, 'org.delete')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')
  const [saved, setSaved] = useState(false)

  const rename = useForm<Values>({ resolver: zodResolver(organizationSchema), values: { name: organization.organizationName } })
  const create = useForm<Values>({ resolver: zodResolver(organizationSchema), defaultValues: { name: '' } })

  const refreshMemberships = () => queryClient.invalidateQueries({ queryKey: ['memberships'] })

  const doRename = useMutation({
    mutationFn: (v: Values) => renameOrganization(orgId, v.name),
    onSuccess: async () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await Promise.all([refreshMemberships(), queryClient.invalidateQueries({ queryKey: ['activity'] })])
    },
  })
  const doCreate = useMutation({
    mutationFn: (v: Values) => createOrganization(v.name),
    onSuccess: async (id) => {
      create.reset()
      await refreshMemberships()
      setOrganizationId(id)
    },
  })
  const doDelete = useMutation({
    mutationFn: () => deleteOrganization(orgId),
    onSuccess: async () => {
      setConfirmDelete(false)
      setTyped('')
      await queryClient.invalidateQueries()
    },
  })

  const offline = !snapshot.online

  return (
    <>
      <PageHeader title="Settings" description={organization.organizationName} />
      {offline && <p role="alert" className="mb-3 text-sm text-warn">You are offline. Settings need a connection.</p>}
      <div className="grid max-w-3xl gap-4">
        <Panel className="p-4">
          <h2 className="mb-3 font-semibold">Organization</h2>
          <form onSubmit={rename.handleSubmit((v) => doRename.mutate(v))} className="flex flex-wrap items-end gap-2" noValidate>
            <div className="min-w-56 flex-1">
              <Field label="Name" disabled={!canRename} error={rename.formState.errors.name?.message} {...rename.register('name')} />
            </div>
            <Button type="submit" variant="primary" loading={doRename.isPending} disabled={!canRename || offline || !rename.formState.isDirty}>
              {saved ? 'Saved' : 'Save name'}
            </Button>
          </form>
          {!canRename && <p className="mt-2 text-xs text-fg-2">Only admins and owners can rename the organization.</p>}
          {doRename.isError && (
            <p role="alert" className="mt-2 text-sm text-crit">
              {errorMessage(doRename.error)}
            </p>
          )}
        </Panel>

        <Panel className="p-4">
          <h2 className="mb-1 font-semibold">Create another organization</h2>
          <p className="mb-3 text-sm text-fg-2">Each organization has its own inventories, team and settings. You become its owner.</p>
          <form onSubmit={create.handleSubmit((v) => doCreate.mutate(v))} className="flex flex-wrap items-end gap-2" noValidate>
            <div className="min-w-56 flex-1">
              <Field label="Organization name" error={create.formState.errors.name?.message} {...create.register('name')} />
            </div>
            <Button type="submit" loading={doCreate.isPending} disabled={offline}>
              Create organization
            </Button>
          </form>
          {doCreate.isError && (
            <p role="alert" className="mt-2 text-sm text-crit">
              {errorMessage(doCreate.error)}
            </p>
          )}
        </Panel>

        {canDelete && (
          <Panel className="border-crit p-4">
            <h2 className="mb-1 font-semibold text-crit">Delete organization</h2>
            <p className="mb-3 text-sm text-fg-2">
              Permanently deletes <b>{organization.organizationName}</b> with all its inventories, products, stock history, transfers and team. This cannot be undone. Consider exporting your data first.
            </p>
            <Button variant="danger" disabled={offline} onClick={() => setConfirmDelete(true)}>
              Delete organization…
            </Button>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          setConfirmDelete(o)
          if (!o) setTyped('')
        }}
        title="Delete this organization?"
        description={`Everything in ${organization.organizationName} will be permanently deleted. Type the organization name to confirm.`}
        confirmLabel="Delete everything"
        destructive
        loading={doDelete.isPending}
        confirmDisabled={typed.trim() !== organization.organizationName}
        error={doDelete.isError ? errorMessage(doDelete.error) : null}
        onConfirm={() => doDelete.mutate()}
      >
        <Input aria-label="Type the organization name to confirm" placeholder={organization.organizationName} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        {typed !== '' && typed.trim() !== organization.organizationName && <p className="mt-1 text-xs text-fg-2">The name does not match yet.</p>}
      </ConfirmDialog>
    </>
  )
}
