import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Minus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { ORG_ROLES, type OrgRole } from '@/domain/permissions'
import { assignableRoles, canRemoveMember, invitableRoles, isLastOwner, permissionMatrix, ROLE_LABEL, ROLE_SUMMARY } from '@/domain/team'
import { errorMessage } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { useOffline } from '@/offline/OfflineProvider'
import { inviteMember, leaveOrganization, listInvitations, listMembers, removeMember, revokeInvitation, setMemberRole, type Member } from './api'

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  role: z.enum(['admin', 'editor', 'viewer']),
})
type InviteValues = z.infer<typeof inviteSchema>

const selectClass = 'h-8 rounded-md border border-line bg-bg-2 px-2 text-sm disabled:opacity-60'

export function TeamPage() {
  const { user } = useAuth()
  const { organization, role } = useWorkspace()
  const { snapshot } = useOffline()
  const queryClient = useQueryClient()
  const orgId = organization.organizationId
  const [removing, setRemoving] = useState<Member | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [lastInvited, setLastInvited] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => listMembers(orgId) })
  const canSeeInvites = role === 'owner' || role === 'admin'
  const invitations = useQuery({ queryKey: ['invitations', orgId], queryFn: () => listInvitations(orgId), enabled: canSeeInvites })
  const refresh = () => Promise.all(['members', 'invitations', 'activity'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))

  const roles = invitableRoles(role)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', role: roles.includes('editor') ? 'editor' : 'viewer' } })

  const invite = useMutation({
    mutationFn: (v: InviteValues) => inviteMember(orgId, v.email, v.role),
    onSuccess: async (_id, v) => {
      setLastInvited(v.email)
      reset({ email: '', role: v.role })
      await refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => revokeInvitation(id), onSuccess: refresh })
  const changeRole = useMutation({ mutationFn: (v: { userId: string; role: OrgRole }) => setMemberRole(orgId, v.userId, v.role), onSuccess: refresh })
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(orgId, userId),
    onSuccess: async () => {
      setRemoving(null)
      await refresh()
    },
  })
  const leave = useMutation({
    mutationFn: () => leaveOrganization(orgId),
    onSuccess: async () => {
      setLeaving(false)
      await queryClient.invalidateQueries({ queryKey: ['memberships'] })
    },
  })

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const list = members.data ?? []
  const lastOwner = user ? isLastOwner(list, user.id) : false
  const matrix = permissionMatrix()
  const actionError = changeRole.error ?? revoke.error

  return (
    <>
      <PageHeader title="Team" description={`${organization.organizationName} · you are ${ROLE_LABEL[role].toLowerCase()}`} />
      {!snapshot.online && <p role="alert" className="mb-3 text-sm text-warn">You are offline. Team changes need a connection.</p>}
      {actionError && (
        <p role="alert" className="mb-3 text-sm text-crit">
          {errorMessage(actionError)}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Panel className="overflow-hidden">
            <h2 className="border-b border-line px-4 py-2 font-semibold">
              Members <span className="num font-normal text-fg-2">· {list.length}</span>
            </h2>
            {members.isPending && <LoadingState />}
            {members.isError && <ErrorState message={errorMessage(members.error)} onRetry={() => void members.refetch()} />}
            <ul className="divide-y divide-line">
              {list.map((m) => {
                const isSelf = m.user_id === user?.id
                const options = assignableRoles(role, m.role, isSelf)
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {m.profile?.full_name ?? m.profile?.email ?? 'Unknown user'} {isSelf && <span className="text-xs font-normal text-fg-2">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-fg-2">
                        {m.profile?.email} · joined {new Date(m.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {options.length > 0 ? (
                        <select
                          aria-label={`Role of ${m.profile?.email ?? 'member'}`}
                          className={selectClass}
                          value={m.role}
                          disabled={changeRole.isPending || !snapshot.online || (isSelf && lastOwner)}
                          onChange={(e) => changeRole.mutate({ userId: m.user_id, role: e.target.value as OrgRole })}
                        >
                          {options.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={m.role === 'owner' ? 'info' : 'neutral'}>{ROLE_LABEL[m.role]}</StatusBadge>
                      )}
                      {canRemoveMember(role, m.role, isSelf) && (
                        <Button size="sm" variant="ghost" disabled={!snapshot.online} onClick={() => setRemoving(m)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-line p-4">
              <Button disabled={!snapshot.online || lastOwner} onClick={() => setLeaving(true)}>
                Leave organization
              </Button>
              {lastOwner && <p className="mt-2 text-xs text-fg-2">You are the only owner. Promote another member to owner before leaving.</p>}
            </div>
          </Panel>

          {roles.length > 0 && (
            <Panel className="p-4">
              <h2 className="mb-1 font-semibold">Invite someone</h2>
              <p className="mb-3 text-sm text-fg-2">
                Enter their email address and choose a role. They will see the invitation when they sign in, or sign up, with <b>that address</b>. No link or code is needed, and nobody else can use it.
              </p>
              <form onSubmit={handleSubmit((v) => invite.mutate(v))} className="flex flex-wrap items-end gap-2" noValidate>
                <div className="min-w-56 flex-1">
                  <Field label="Email" type="email" autoComplete="off" error={errors.email?.message} {...register('email')} />
                </div>
                <div className="space-y-1">
                  <label htmlFor="invite-role" className="block text-[13px] font-medium">
                    Role
                  </label>
                  <select id="invite-role" className="h-9 rounded-md border border-line bg-bg-2 px-2 text-sm" {...register('role')}>
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" variant="primary" loading={invite.isPending} disabled={!snapshot.online}>
                  Send invitation
                </Button>
              </form>
              {invite.isError && (
                <p role="alert" className="mt-3 text-sm text-crit">
                  {errorMessage(invite.error)}
                </p>
              )}
              {lastInvited && (
                <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-ok px-3 py-2 text-sm">
                  <span>
                    Invitation saved for <b>{lastInvited}</b>. Let them know to sign in or sign up at the app link.
                  </span>
                  <Button size="sm" onClick={() => void copyLink()}>
                    {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? 'Copied' : 'Copy app link'}
                  </Button>
                </div>
              )}
            </Panel>
          )}

          {canSeeInvites && (
            <Panel className="overflow-hidden">
              <h2 className="border-b border-line px-4 py-2 font-semibold">
                Pending invitations <span className="num font-normal text-fg-2">· {invitations.data?.length ?? 0}</span>
              </h2>
              {invitations.isPending && <LoadingState />}
              {invitations.data && invitations.data.length === 0 && <p className="p-4 text-sm text-fg-2">No pending invitations.</p>}
              <ul className="divide-y divide-line">
                {invitations.data?.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.email}</p>
                      <p className="num text-xs text-fg-2">
                        {ROLE_LABEL[i.role]} · expires {new Date(i.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button size="sm" loading={revoke.isPending && revoke.variables === i.id} disabled={!snapshot.online} onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <Panel className="h-fit overflow-hidden">
          <h2 className="border-b border-line px-4 py-2 font-semibold">Roles and permissions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-surface uppercase tracking-wide text-fg-2">
                <tr>
                  <th className="px-3 py-2">Can…</th>
                  {ORG_ROLES.map((r) => (
                    <th key={r} className="px-2 py-2 text-center">
                      {ROLE_LABEL[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {matrix.map((row) => (
                  <tr key={row.label}>
                    <td className="px-3 py-2">{row.label}</td>
                    {ORG_ROLES.map((r) => (
                      <td key={r} className="px-2 py-2 text-center">
                        {row.roles[r] ? <Check className="mx-auto h-4 w-4 text-ok" aria-label="Allowed" /> : <Minus className="mx-auto h-4 w-4 text-fg-2" aria-label="Not allowed" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-1 border-t border-line p-4 text-xs text-fg-2">
            {ORG_ROLES.map((r) => (
              <li key={r}>
                <b className="text-fg">{ROLE_LABEL[r]}:</b> {ROLE_SUMMARY[r]}
              </li>
            ))}
            <li className="pt-1">Permissions are enforced by the database, not just by this screen.</li>
          </ul>
        </Panel>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this member?"
        description={`${removing?.profile?.email ?? 'This person'} will lose access to ${organization.organizationName} immediately. Their past activity stays in the history.`}
        confirmLabel="Remove member"
        destructive
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() => removing && remove.mutate(removing.user_id)}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave this organization?"
        description={`You will lose access to ${organization.organizationName} and its inventories. An admin would need to invite you again.`}
        confirmLabel="Leave organization"
        destructive
        loading={leave.isPending}
        error={leave.isError ? errorMessage(leave.error) : null}
        onConfirm={() => leave.mutate()}
      />
    </>
  )
}
