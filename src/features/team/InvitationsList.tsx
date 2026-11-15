import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ROLE_LABEL } from '@/domain/team'
import { errorMessage } from '@/lib/supabase'
import { acceptInvitation, declineInvitation, listMyInvitations } from './api'

/**
 * Invitations addressed to the signed-in user's verified email. Accepting joins the organization at once.
 * `onAccepted` receives the organization id so the caller can switch to it.
 */
export function InvitationsList({ compact = false, onAccepted }: { compact?: boolean; onAccepted?: (organizationId: string) => void }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['my-invitations'], queryFn: listMyInvitations, refetchInterval: 60_000, retry: false })

  const refresh = () =>
    Promise.all(['my-invitations', 'memberships', 'members', 'invitations'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))

  const accept = useMutation({
    mutationFn: (id: string) => acceptInvitation(id),
    onSuccess: async (orgId) => {
      await refresh()
      onAccepted?.(orgId)
    },
  })
  const decline = useMutation({ mutationFn: (id: string) => declineInvitation(id), onSuccess: refresh })

  const invitations = query.data ?? []
  if (invitations.length === 0) return null
  const error = accept.error ?? decline.error

  return (
    <div className={compact ? 'border-b border-line bg-surface px-3 py-2 md:px-6' : 'space-y-2'} role="region" aria-label="Invitations">
      {invitations.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>
            <b>{i.invited_by_name ?? 'Someone'}</b> invited you to join <b>{i.organization_name}</b> as {ROLE_LABEL[i.role].toLowerCase()}.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={accept.isPending && accept.variables === i.id} disabled={accept.isPending || decline.isPending} onClick={() => accept.mutate(i.id)}>
              Accept
            </Button>
            <Button size="sm" disabled={accept.isPending || decline.isPending} onClick={() => decline.mutate(i.id)}>
              Decline
            </Button>
          </div>
        </div>
      ))}
      {error && (
        <p role="alert" className="mt-1 text-sm text-crit">
          {errorMessage(error)}
        </p>
      )}
    </div>
  )
}
