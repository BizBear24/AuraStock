import { supabase } from '@/lib/supabase'
import { getMeta, setMeta } from '@/offline/db'
import { bestEffort } from '@/offline/local'
import { readThrough } from '@/offline/resilient'
import type { OrgRole } from '@/domain/permissions'

export interface Membership {
  organizationId: string
  organizationName: string
  role: OrgRole
}

export interface Inventory {
  id: string
  organization_id: string
  name: string
  description: string | null
  archived_at: string | null
  created_at: string
}

interface MembershipRow {
  organization_id: string
  role: OrgRole
  organizations: { name: string } | null
}

async function fetchMembershipsRemote(userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations(name)')
    .eq('user_id', userId)
    .returns<MembershipRow[]>()
  if (error) throw error
  return data.map((r) => ({
    organizationId: r.organization_id,
    organizationName: r.organizations?.name ?? 'Unnamed organization',
    role: r.role,
  }))
}

export async function createOrganization(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_organization', { org_name: name })
  if (error) throw error
  return data as string
}

async function fetchInventoriesRemote(organizationId: string): Promise<Inventory[]> {
  const { data, error } = await supabase
    .from('inventories')
    .select('id, organization_id, name, description, archived_at, created_at')
    .eq('organization_id', organizationId)
    .is('archived_at', null)
    .order('name')
    .returns<Inventory[]>()
  if (error) throw error
  return data
}

export async function createInventory(input: {
  organizationId: string
  name: string
  description?: string
  userId: string
}): Promise<Inventory> {
  const { data, error } = await supabase
    .from('inventories')
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      description: input.description || null,
      created_by: input.userId,
    })
    .select('id, organization_id, name, description, archived_at, created_at')
    .single<Inventory>()
  if (error) throw error
  return data
}

/** Cached after each successful load so the app can open offline. */
export function fetchMemberships(userId: string): Promise<Membership[]> {
  return readThrough(
    async () => {
      const memberships = await fetchMembershipsRemote(userId)
      bestEffort(setMeta('workspace:memberships', memberships), 'cache memberships')
      return memberships
    },
    async () => {
      const cached = await getMeta<Membership[]>('workspace:memberships')
      if (!cached) throw new Error('Your workspace has not been saved on this device yet. Connect once to use the app offline.')
      return cached
    },
  )
}

export function fetchInventories(organizationId: string): Promise<Inventory[]> {
  const key = `workspace:inventories:${organizationId}`
  return readThrough(
    async () => {
      const inventories = await fetchInventoriesRemote(organizationId)
      bestEffort(setMeta(key, inventories), 'cache inventories')
      return inventories
    },
    async () => (await getMeta<Inventory[]>(key)) ?? [],
  )
}
