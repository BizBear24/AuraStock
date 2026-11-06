export const ORG_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export type OrgRole = (typeof ORG_ROLES)[number]

export type Permission =
  | 'org.manage'
  | 'org.delete'
  | 'members.manage'
  | 'inventory.manage'
  | 'product.write'
  | 'stock.write'
  | 'data.read'

const RANK: Record<OrgRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }

/** Minimum role required for each permission. Mirrors the RLS policies in supabase/migrations. */
const REQUIRED_ROLE: Record<Permission, OrgRole> = {
  'data.read': 'viewer',
  'stock.write': 'editor',
  'product.write': 'editor',
  'inventory.manage': 'admin',
  'members.manage': 'admin',
  'org.manage': 'admin',
  'org.delete': 'owner',
}

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value)
}

export function hasRole(role: OrgRole | null | undefined, minimum: OrgRole): boolean {
  return role != null && RANK[role] >= RANK[minimum]
}

/** UI-only check. The database remains the authority. */
export function can(role: OrgRole | null | undefined, permission: Permission): boolean {
  return hasRole(role, REQUIRED_ROLE[permission])
}

/** Owners may assign any role; admins may assign only roles below admin. */
export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  if (actor === 'owner') return true
  return actor === 'admin' && RANK[target] < RANK.admin
}
