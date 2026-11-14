import { useQuery } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { PageHeader, Panel } from '@/components/ui/panel'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { errorMessage, supabase } from '@/lib/supabase'
import { useOffline } from '@/offline/OfflineProvider'
import { useAuth } from './AuthProvider'

interface Profile {
  email: string
  full_name: string | null
  created_at: string
}

export function ProfilePage() {
  const { user, signOut } = useAuth()
  const { snapshot } = useOffline()
  const [confirming, setConfirming] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const unsynced = snapshot.pending + snapshot.failed + snapshot.conflicts

  const query = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('email, full_name, created_at')
        .eq('id', user!.id)
        .single<Profile>()
      if (error) throw error
      return data
    },
    enabled: Boolean(user),
  })

  const doSignOut = async () => {
    setSignOutError(null)
    try {
      await signOut()
    } catch (e) {
      setSignOutError(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader title="Profile" />
      <Panel className="max-w-md p-4">
        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
        {query.data && (
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-fg-2">Name</dt>
            <dd>{query.data.full_name ?? '—'}</dd>
            <dt className="text-fg-2">Email</dt>
            <dd className="break-all">{query.data.email}</dd>
            <dt className="text-fg-2">Member since</dt>
            <dd className="num">{new Date(query.data.created_at).toLocaleDateString()}</dd>
          </dl>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <Button onClick={() => (unsynced > 0 ? setConfirming(true) : void doSignOut())}>
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </Button>
          {signOutError && (
            <p role="alert" className="mt-2 text-sm text-crit">
              {signOutError}
            </p>
          )}
        </div>
      </Panel>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Sign out with unsynced changes?"
        description={`${unsynced} change${unsynced === 1 ? ' is' : 's are'} still saved only on this device. They stay here and will be sent the next time you sign in on this device. Until then, other devices will not see them.`}
        confirmLabel="Sign out anyway"
        destructive
        onConfirm={() => void doSignOut()}
      />
    </>
  )
}
