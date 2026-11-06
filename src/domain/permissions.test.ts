import { can, canAssignRole, hasRole, isOrgRole } from './permissions'

describe('permissions', () => {
  it('orders roles by rank', () => {
    expect(hasRole('owner', 'admin')).toBe(true)
    expect(hasRole('viewer', 'editor')).toBe(false)
    expect(hasRole(null, 'viewer')).toBe(false)
  })

  it('viewers can only read', () => {
    expect(can('viewer', 'data.read')).toBe(true)
    expect(can('viewer', 'stock.write')).toBe(false)
    expect(can('viewer', 'product.write')).toBe(false)
  })

  it('editors manage stock but not members', () => {
    expect(can('editor', 'stock.write')).toBe(true)
    expect(can('editor', 'members.manage')).toBe(false)
  })

  it('only owners delete the organization', () => {
    expect(can('admin', 'org.delete')).toBe(false)
    expect(can('owner', 'org.delete')).toBe(true)
  })

  it('admins cannot assign admin or owner', () => {
    expect(canAssignRole('admin', 'editor')).toBe(true)
    expect(canAssignRole('admin', 'admin')).toBe(false)
    expect(canAssignRole('admin', 'owner')).toBe(false)
    expect(canAssignRole('editor', 'viewer')).toBe(false)
    expect(canAssignRole('owner', 'owner')).toBe(true)
  })

  it('validates role strings', () => {
    expect(isOrgRole('editor')).toBe(true)
    expect(isOrgRole('root')).toBe(false)
  })
})
