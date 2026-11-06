import { useQuery } from '@tanstack/react-query'
import { PageHeader, Panel } from '@/components/ui/panel'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { errorMessage, supabase } from '@/lib/supabase'
import { useAuth } from './AuthProvider'

interface Profile {
  email: string
  full_name: string | null
  created_at: string
}

export function ProfilePage() {
  const { user } = useAuth()
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
      </Panel>
    </>
  )
}
