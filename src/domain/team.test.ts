import { ORG_ROLES } from './permissions'
import {
  ACTIVITY_CATEGORIES,
  assignableRoles,
  canRemoveMember,
  describeActivity,
  invitableRoles,
  isLastOwner,
  permissionMatrix,
} from './team'

describe('invitableRoles', () => {
  it('lets owners invite admins and admins invite only editors and viewers', () => {
    expect(invitableRoles('owner')).toEqual(['admin', 'editor', 'viewer'])
    expect(invitableRoles('admin')).toEqual(['editor', 'viewer'])
    expect(invitableRoles('editor')).toEqual([])
    expect(invitableRoles('viewer')).toEqual([])
    expect(invitableRoles(null)).toEqual([])
  })
})

describe('assignableRoles', () => {
  it('owners can set any role', () => {
    expect(assignableRoles('owner', 'viewer', false)).toEqual([...ORG_ROLES])
    expect(assignableRoles('owner', 'owner', true)).toEqual([...ORG_ROLES])
  })
  it('admins manage only editors and viewers, never themselves', () => {
    expect(assignableRoles('admin', 'editor', false)).toEqual(['editor', 'viewer'])
    expect(assignableRoles('admin', 'admin', false)).toEqual([])
    expect(assignableRoles('admin', 'owner', false)).toEqual([])
    expect(assignableRoles('admin', 'viewer', true)).toEqual([])
  })
  it('editors and viewers manage nobody', () => {
    expect(assignableRoles('editor', 'viewer', false)).toEqual([])
    expect(assignableRoles('viewer', 'viewer', false)).toEqual([])
  })
})

describe('canRemoveMember', () => {
  it('follows the same limits', () => {
    expect(canRemoveMember('owner', 'admin', false)).toBe(true)
    expect(canRemoveMember('admin', 'editor', false)).toBe(true)
    expect(canRemoveMember('admin', 'admin', false)).toBe(false)
    expect(canRemoveMember('admin', 'owner', false)).toBe(false)
    expect(canRemoveMember('owner', 'owner', true)).toBe(false) // leave instead
    expect(canRemoveMember('editor', 'viewer', false)).toBe(false)
  })
})

describe('isLastOwner', () => {
  const members = [
    { user_id: 'a', role: 'owner' as const },
    { user_id: 'b', role: 'admin' as const },
  ]
  it('detects the only owner', () => {
    expect(isLastOwner(members, 'a')).toBe(true)
    expect(isLastOwner(members, 'b')).toBe(false)
    expect(isLastOwner([...members, { user_id: 'c', role: 'owner' as const }], 'a')).toBe(false)
  })
})

describe('permissionMatrix', () => {
  it('is cumulative: each role can do at least what the one below can', () => {
    const rows = permissionMatrix()
    for (const row of rows) {
      const [owner, admin, editor, viewer] = [row.roles.owner, row.roles.admin, row.roles.editor, row.roles.viewer]
      expect(Number(owner)).toBeGreaterThanOrEqual(Number(admin))
      expect(Number(admin)).toBeGreaterThanOrEqual(Number(editor))
      expect(Number(editor)).toBeGreaterThanOrEqual(Number(viewer))
    }
    expect(rows.find((r) => r.label.startsWith('View'))?.roles).toEqual({ owner: true, admin: true, editor: true, viewer: true })
    expect(rows.find((r) => r.label.startsWith('Delete the organization'))?.roles).toEqual({ owner: true, admin: false, editor: false, viewer: false })
  })
})

describe('describeActivity', () => {
  it('describes stock movements with their effect', () => {
    expect(describeActivity('stock.out', { product: 'Rice', delta: -3, after: 5 }, 'Main')).toBe('Stock out: Rice (-3, now 5) in Main')
    expect(describeActivity('stock.in', { product: 'Rice', delta: 8, after: 8 })).toBe('Stock in: Rice (+8, now 8)')
  })
  it('describes product, inventory and transfer events', () => {
    expect(describeActivity('product.create', { name: 'Flour' }, 'Shop')).toBe('Created product Flour in Shop')
    expect(describeActivity('inventory.create', { name: 'Annex' })).toBe('Created inventory Annex')
    expect(describeActivity('transfer.dispatch', { reference: 'TR-00001', to: 'Shop' })).toBe('Dispatched transfer TR-00001 to Shop')
    expect(describeActivity('transfer.close', { reference: 'TR-00001', missing: 2 })).toBe('Closed transfer TR-00001 with 2 unit(s) missing')
  })
  it('describes team events', () => {
    expect(describeActivity('member.invite', { email: 'e@x.test', role: 'editor' })).toBe('Invited e@x.test as editor')
    expect(describeActivity('member.role', { from: 'viewer', to: 'editor' })).toBe("Changed a member's role from viewer to editor")
    expect(describeActivity('member.leave')).toBe('Left the organization')
    expect(describeActivity('org.rename', { from: 'A', to: 'B' })).toBe('Renamed the organization from A to B')
  })
  it('falls back to the raw action for unknown events', () => {
    expect(describeActivity('something.new')).toBe('something.new')
  })
  it('has a category for every action prefix used', () => {
    expect(ACTIVITY_CATEGORIES.map((c) => c.id)).toEqual(['stock', 'product', 'inventory', 'transfer', 'member', 'import', 'org', 'demo'])
  })
})
