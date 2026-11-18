// @vitest-environment node
import { sha256Hex } from '@/domain/backup'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
const { checkStoredBackup, createBackup, verifyBackup } = await import('./api')
type Target = Parameters<typeof createBackup>[0]['target']

const document = {
  format: 'aurastock-backup',
  version: 1,
  created_at: '2026-11-18T10:00:00Z',
  organization: { id: 'org', name: 'Acme' },
  inventories: [{ id: 'inv', name: 'Main' }],
  categories: [],
  tags: [],
  products: [{ id: 'p1', inventory_id: 'inv', name: 'Rice', quantity: 3 }],
  product_tags: [],
  stock_movements: [{ id: 'm1', product_id: 'p1', created_at: '2026-11-01T10:00:00Z', delta: 3, quantity_before: 0, quantity_after: 3 }],
  transfers: [],
  transfer_lines: [],
}

function memoryTarget(overrides: Partial<Target> = {}) {
  const files = new Map<string, string>()
  const target: Target = {
    destination: 'supabase',
    async put(org, id, _name, text) {
      files.set(`${org}/${id}.json`, text)
      return { storagePath: `${org}/${id}.json`, externalId: null }
    },
    async get(r) {
      const text = files.get(r.storage_path ?? '')
      if (text === undefined) throw new Error('not found')
      return text
    },
    async remove(r) {
      files.delete(r.storage_path ?? '')
    },
    ...overrides,
  }
  return { target, files }
}

const deps = () => ({
  exportDocument: vi.fn().mockResolvedValue(document),
  register: vi.fn().mockResolvedValue(undefined),
  markVerified: vi.fn().mockResolvedValue(undefined),
  newId: () => 'b-1',
})

describe('createBackup', () => {
  it('stores the exact bytes, records size and checksum, then verifies by reading back', async () => {
    const d = deps()
    const { target, files } = memoryTarget()
    const r = await createBackup({ organizationId: 'org', fileName: (id) => `${id}.json`, kind: 'manual', target }, d)
    const stored = files.get('org/b-1.json')!
    expect(JSON.parse(stored)).toEqual(document)
    expect(d.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b-1', kind: 'manual', destination: 'supabase', storagePath: 'org/b-1.json', size: stored.length, sha256: await sha256Hex(stored), counts: expect.objectContaining({ products: 1, movements: 1 }) }),
    )
    expect(d.markVerified).toHaveBeenCalledWith('b-1', true, null)
    expect(r).toMatchObject({ id: 'b-1', verified: true, verifyError: null })
  })

  it('records a failed verification when the stored file differs', async () => {
    const d = deps()
    const { target } = memoryTarget({ get: async () => '{"tampered": true}' })
    const r = await createBackup({ organizationId: 'org', fileName: (id) => id, kind: 'automatic', target }, d)
    expect(r.verified).toBe(false)
    expect(r.verifyError).toBe('The stored file does not match its checksum.')
    expect(d.markVerified).toHaveBeenCalledWith('b-1', false, 'The stored file does not match its checksum.')
  })

  it('records a failed verification when the file cannot be read back', async () => {
    const d = deps()
    const { target } = memoryTarget({ get: async () => Promise.reject(new Error('network down')) })
    const r = await createBackup({ organizationId: 'org', fileName: (id) => id, kind: 'manual', target }, d)
    expect(r.verifyError).toBe('The stored file could not be read back: network down')
  })

  it('does not register anything when the upload fails', async () => {
    const d = deps()
    const { target } = memoryTarget({ put: async () => Promise.reject(new Error('quota exceeded')) })
    await expect(createBackup({ organizationId: 'org', fileName: (id) => id, kind: 'manual', target }, d)).rejects.toThrow('quota exceeded')
    expect(d.register).not.toHaveBeenCalled()
  })
})

describe('checkStoredBackup / verifyBackup', () => {
  it('accepts a matching, consistent file', async () => {
    const text = JSON.stringify(document)
    expect(await checkStoredBackup(text, await sha256Hex(text))).toBeNull()
  })

  it('rejects matching bytes whose contents are inconsistent', async () => {
    const bad = JSON.stringify({ ...document, products: [{ ...document.products[0], quantity: 9 }] })
    expect(await checkStoredBackup(bad, await sha256Hex(bad))).toMatch(/inconsistent: "Rice" has quantity 9/)
  })

  it('rejects files that are not JSON', async () => {
    expect(await checkStoredBackup('not json', await sha256Hex('not json'))).toBe('The stored file is not valid JSON.')
  })

  it('re-verifies an existing record and stores the outcome', async () => {
    const text = JSON.stringify(document)
    const markVerified = vi.fn().mockResolvedValue(undefined)
    const { target, files } = memoryTarget()
    files.set('org/b-1.json', text)
    const record = { id: 'b-1', storage_path: 'org/b-1.json', external_id: null, sha256: await sha256Hex(text) } as never
    expect(await verifyBackup(record, target, { markVerified })).toBeNull()
    expect(markVerified).toHaveBeenCalledWith('b-1', true, null)
    files.delete('org/b-1.json')
    expect(await verifyBackup(record, target, { markVerified })).toMatch(/could not be read: not found/)
  })
})
