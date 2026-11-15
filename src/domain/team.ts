import { can, ORG_ROLES, type OrgRole, type Permission } from './permissions'

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

export const ROLE_SUMMARY: Record<OrgRole, string> = {
  owner: 'Full control of the organization, including deleting it and promoting owners.',
  admin: 'Manages inventories, products, stock, and editors and viewers.',
  editor: 'Manages products and records stock movements and transfers.',
  viewer: 'Read-only access to inventories, products, stock and reports.',
}

export const PERMISSION_LABEL: { permission: Permission; label: string }[] = [
  { permission: 'data.read', label: 'View inventories, products and stock' },
  { permission: 'product.write', label: 'Create and edit products' },
  { permission: 'stock.write', label: 'Record stock movements and transfers' },
  { permission: 'inventory.manage', label: 'Create inventories and load demo data' },
  { permission: 'members.manage', label: 'Invite and manage editors and viewers' },
  { permission: 'org.manage', label: 'Rename the organization and view activity' },
  { permission: 'org.delete', label: 'Delete the organization and manage admins and owners' },
]

/** The permission matrix shown on the Team page, derived from the same rules the UI uses. */
export function permissionMatrix(): { label: string; roles: Record<OrgRole, boolean> }[] {
  return PERMISSION_LABEL.map(({ permission, label }) => ({
    label,
    roles: Object.fromEntries(ORG_ROLES.map((r) => [r, can(r, permission)])) as Record<OrgRole, boolean>,
  }))
}

/** Roles `actor` may invite someone as. Owners are never invited; they are promoted from members. */
export function invitableRoles(actor: OrgRole | null | undefined): OrgRole[] {
  if (actor === 'owner') return ['admin', 'editor', 'viewer']
  if (actor === 'admin') return ['editor', 'viewer']
  return []
}

/**
 * Roles `actor` may set on a member who currently has `target`. Mirrors set_member_role() in the database,
 * which is the authority. Admins manage only editors and viewers and cannot change themselves.
 */
export function assignableRoles(actor: OrgRole | null | undefined, target: OrgRole, isSelf: boolean): OrgRole[] {
  if (actor === 'owner') return [...ORG_ROLES]
  if (actor === 'admin' && !isSelf && (target === 'editor' || target === 'viewer')) return ['editor', 'viewer']
  return []
}

export function canRemoveMember(actor: OrgRole | null | undefined, target: OrgRole, isSelf: boolean): boolean {
  if (isSelf) return false // use "Leave organization"
  if (actor === 'owner') return true
  return actor === 'admin' && (target === 'editor' || target === 'viewer')
}

export interface MemberLike {
  user_id: string
  role: OrgRole
}

export function ownerCount(members: MemberLike[]): number {
  return members.filter((m) => m.role === 'owner').length
}

/** The last owner can neither leave, be removed, nor be demoted. */
export function isLastOwner(members: MemberLike[], userId: string): boolean {
  const me = members.find((m) => m.user_id === userId)
  return me?.role === 'owner' && ownerCount(members) <= 1
}

// ------------------------------------------------------------------- activity

export type ActivityCategory = 'stock' | 'product' | 'inventory' | 'transfer' | 'member' | 'import' | 'org' | 'demo'

export const ACTIVITY_CATEGORIES: { id: ActivityCategory; label: string }[] = [
  { id: 'stock', label: 'Stock' },
  { id: 'product', label: 'Products' },
  { id: 'inventory', label: 'Inventories' },
  { id: 'transfer', label: 'Transfers' },
  { id: 'member', label: 'Team' },
  { id: 'import', label: 'Imports' },
  { id: 'org', label: 'Organization' },
  { id: 'demo', label: 'Demo data' },
]

type Details = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

/** One readable sentence for an audit entry, without the actor's name (shown separately). */
export function describeActivity(action: string, details: Details = {}, inventoryName?: string | null): string {
  const where = inventoryName ? ` in ${inventoryName}` : ''
  const product = str(details.product) ?? str(details.name) ?? 'a product'
  switch (action) {
    case 'stock.in':
    case 'stock.out':
    case 'stock.adjustment':
    case 'stock.correction': {
      const kind = action.slice('stock.'.length)
      const delta = num(details.delta)
      const after = num(details.after)
      const label = { in: 'Stock in', out: 'Stock out', adjustment: 'Adjusted', correction: 'Corrected' }[kind] ?? 'Stock change'
      return `${label}: ${product}${delta !== null ? ` (${signed(delta)}${after !== null ? `, now ${after}` : ''})` : ''}${where}`
    }
    case 'product.create':
      return `Created product ${product}${where}`
    case 'product.update':
      return `Edited product ${product}${where}`
    case 'product.archive':
      return `Archived product ${product}${where}`
    case 'product.restore':
      return `Restored product ${product}${where}`
    case 'product.delete':
      return `Deleted product ${product}${where}`
    case 'inventory.create':
      return `Created inventory ${str(details.name) ?? ''}`.trim()
    case 'inventory.update':
      return `Edited inventory ${str(details.name) ?? ''}`.trim()
    case 'inventory.archive':
      return `Archived inventory ${str(details.name) ?? ''}`.trim()
    case 'inventory.restore':
      return `Restored inventory ${str(details.name) ?? ''}`.trim()
    case 'inventory.delete':
      return `Deleted inventory ${str(details.name) ?? ''}`.trim()
    case 'transfer.dispatch':
      return `Dispatched transfer ${str(details.reference) ?? ''}${str(details.to) ? ` to ${str(details.to)}` : ''}`.trim()
    case 'transfer.receive':
      return `Received items on transfer ${str(details.reference) ?? ''}`.trim()
    case 'transfer.complete':
      return `Completed transfer ${str(details.reference) ?? ''}`.trim()
    case 'transfer.close': {
      const missing = num(details.missing)
      return `Closed transfer ${str(details.reference) ?? ''}${missing ? ` with ${missing} unit(s) missing` : ''}`.trim()
    }
    case 'transfer.cancel':
      return `Cancelled transfer ${str(details.reference) ?? ''}`.trim()
    case 'member.invite':
      return `Invited ${str(details.email) ?? 'someone'} as ${str(details.role) ?? 'a member'}`
    case 'member.accept':
      return `Joined the organization as ${str(details.role) ?? 'a member'}`
    case 'member.decline':
      return 'Declined an invitation'
    case 'invite.revoke':
      return `Revoked the invitation for ${str(details.email) ?? 'someone'}`
    case 'member.role':
      return `Changed a member's role from ${str(details.from) ?? '?'} to ${str(details.to) ?? '?'}`
    case 'member.remove':
      return `Removed a ${str(details.role) ?? ''} member`.replace('  ', ' ')
    case 'member.leave':
      return 'Left the organization'
    case 'import.products': {
      const created = num(details.created) ?? 0
      const updated = num(details.updated) ?? 0
      return `Imported products${where}: ${created} created, ${updated} updated`
    }
    case 'org.rename':
      return `Renamed the organization from ${str(details.from) ?? '?'} to ${str(details.to) ?? '?'}`
    case 'demo.seed':
      return `Loaded demo data${where}`
    default:
      return action
  }
}
