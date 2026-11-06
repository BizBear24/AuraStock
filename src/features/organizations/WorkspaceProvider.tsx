import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OrgRole } from '@/domain/permissions'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { errorMessage } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchInventories, fetchMemberships, type Inventory, type Membership } from './api'

interface WorkspaceValue {
  memberships: Membership[]
  organization: Membership
  role: OrgRole
  inventories: Inventory[]
  inventory: Inventory | null
  setOrganizationId: (id: string) => void
  setInventoryId: (id: string) => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)
const ORG_KEY = 'aurastock.org'
const INV_KEY = 'aurastock.inventory'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: selection simply won't persist */
  }
}

/** Resolves the active organization and inventory. Renders `onboarding` when the user has no organization. */
export function WorkspaceProvider({ children, onboarding }: { children: ReactNode; onboarding: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const [orgId, setOrgId] = useState<string | null>(() => readStored(ORG_KEY))
  const [invId, setInvId] = useState<string | null>(() => readStored(INV_KEY))

  const memberships = useQuery({
    queryKey: ['memberships', userId],
    queryFn: () => fetchMemberships(userId),
    enabled: Boolean(userId),
  })

  const organization = useMemo(
    () => memberships.data?.find((m) => m.organizationId === orgId) ?? memberships.data?.[0] ?? null,
    [memberships.data, orgId],
  )

  const inventoriesQuery = useQuery({
    queryKey: ['inventories', organization?.organizationId],
    queryFn: () => fetchInventories(organization!.organizationId),
    enabled: Boolean(organization),
  })

  const inventories = useMemo(() => inventoriesQuery.data ?? [], [inventoriesQuery.data])
  const inventory = inventories.find((i) => i.id === invId) ?? inventories[0] ?? null

  useEffect(() => {
    if (organization) writeStored(ORG_KEY, organization.organizationId)
  }, [organization])
  useEffect(() => {
    if (inventory) writeStored(INV_KEY, inventory.id)
  }, [inventory])

  const setOrganizationId = useCallback((id: string) => setOrgId(id), [])
  const setInventoryId = useCallback((id: string) => setInvId(id), [])

  const value = useMemo<WorkspaceValue | null>(
    () =>
      organization
        ? {
            memberships: memberships.data ?? [],
            organization,
            role: organization.role,
            inventories,
            inventory,
            setOrganizationId,
            setInventoryId,
          }
        : null,
    [organization, memberships.data, inventories, inventory, setOrganizationId, setInventoryId],
  )

  if (memberships.isPending) return <LoadingState label="Loading workspace" />
  if (memberships.isError) {
    return <ErrorState message={errorMessage(memberships.error)} onRetry={() => void memberships.refetch()} />
  }
  if (!value) return <>{onboarding}</>
  if (inventoriesQuery.isError) {
    return <ErrorState message={errorMessage(inventoriesQuery.error)} onRetry={() => void inventoriesQuery.refetch()} />
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}
