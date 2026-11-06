import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { errorMessage } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { organizationSchema } from '@/features/auth/schemas'
import type { z } from 'zod'
import { createOrganization } from './api'

type Values = z.infer<typeof organizationSchema>

export function OnboardingPage() {
  const { user, signOut } = useAuth()
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(organizationSchema) })

  const create = useMutation({
    mutationFn: (v: Values) => createOrganization(v.name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memberships'] }),
  })

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-fg-2">Setup</p>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Create your organization</h1>
        <p className="mb-4 text-sm text-fg-2">
          An organization holds your inventories, products and team. Signed in as {user?.email}.
        </p>
        <form
          onSubmit={handleSubmit((v) => create.mutate(v))}
          className="space-y-3 rounded-lg border border-line bg-bg-2 p-5"
          noValidate
        >
          {create.isError && (
            <p role="alert" className="rounded-md border border-crit px-3 py-2 text-sm text-crit">
              {errorMessage(create.error)}
            </p>
          )}
          <Field label="Organization name" autoComplete="organization" error={errors.name?.message} {...register('name')} />
          <Button type="submit" variant="primary" className="w-full" loading={create.isPending}>
            Create organization
          </Button>
        </form>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  )
}
