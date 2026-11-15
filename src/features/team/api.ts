import type { OrgRole } from '@/domain/permissions'
import { supabase } from '@/lib/supabase'

export interface Member {
  user_id: string
  role: OrgRole
  created_at: string
  profile: { email: string; full_name: string | null } | null
}

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  status: 'pending' | 'accepted' | 'declined' | 'revoked'
  created_at: string
  expires_at: string
}

export interface MyInvitation {
  id: string
  organization_id: string
  organization_name: string
  role: OrgRole
  invited_by_name: string | null
  created_at: string
  expires_at: string
}

export interface ActivityEntry {
  id: string
  created_at: string
  action: string
  entity_type: string
  entity_id: string | null
  inventory_id: string | null
  inventory_name: string | null
  actor_id: string | null
  actor_name: string | null
  details: Record<string, unknown>
  total_count: number
}

export const ACTIVITY_PAGE_SIZE = 30

export async function listMembers(organizationId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('user_id, role, created_at, profile:profiles(email, full_name)')
    .eq('organization_id', organizationId)
    .order('created_at')
    .returns<Member[]>()
  if (error) throw error
  return data
}

/** Pending invitations of the organization (admins and owners only; RLS hides them from everyone else). */
export async function listInvitations(organizationId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, role, status, created_at, expires_at')
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .returns<Invitation[]>()
  if (error) throw error
  return data
}

export async function inviteMember(organizationId: string, email: string, role: OrgRole): Promise<string> {
  const { data, error } = await supabase.rpc('invite_member', { p_org: organizationId, p_email: email, p_role: role })
  if (error) throw error
  return data as string
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invitation', { p_invitation: invitationId })
  if (error) throw error
}

export async function setMemberRole(organizationId: string, userId: string, role: OrgRole): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', { p_org: organizationId, p_user: userId, p_role: role })
  if (error) throw error
}

export async function removeMember(organizationId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { p_org: organizationId, p_user: userId })
  if (error) throw error
}

export async function leaveOrganization(organizationId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_organization', { p_org: organizationId })
  if (error) throw error
}

export async function listMyInvitations(): Promise<MyInvitation[]> {
  const { data, error } = await supabase.rpc('list_my_invitations')
  if (error) throw error
  return (data ?? []) as MyInvitation[]
}

export async function acceptInvitation(invitationId: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invitation', { p_invitation: invitationId })
  if (error) throw error
  return data as string
}

export async function declineInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_invitation', { p_invitation: invitationId })
  if (error) throw error
}

export async function listActivity(input: { organizationId: string; category: string | null; page: number }): Promise<{ rows: ActivityEntry[]; total: number }> {
  const { data, error } = await supabase.rpc('list_activity', {
    p_org: input.organizationId,
    p_category: input.category,
    p_limit: ACTIVITY_PAGE_SIZE,
    p_offset: input.page * ACTIVITY_PAGE_SIZE,
  })
  if (error) throw error
  const rows = (data ?? []) as ActivityEntry[]
  return { rows, total: Number(rows[0]?.total_count ?? 0) }
}

/** Rename the organization (admins and owners; enforced by row-level security). */
export async function renameOrganization(organizationId: string, name: string): Promise<void> {
  const { data, error } = await supabase.from('organizations').update({ name }).eq('id', organizationId).select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('You do not have permission to rename this organization.')
}

/** Permanently delete the organization and everything in it (owners only; enforced by row-level security). */
export async function deleteOrganization(organizationId: string): Promise<void> {
  const { data, error } = await supabase.from('organizations').delete().eq('id', organizationId).select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('Only owners can delete an organization.')
}
