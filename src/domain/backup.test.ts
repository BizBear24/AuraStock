import { backupFileName, backupsToPrune, sha256Hex, utf8Size, validateBackup } from './backup'

const doc = () => ({
  format: 'aurastock-backup',
  version: 1,
  created_at: '2026-11-18T10:00:00Z',
  organization: { id: 'org', name: 'Acme' },
  inventories: [
    { id: 'inv', name: 'Main', is_demo: false },
    { id: 'demo', name: 'Demo', is_demo: true },
  ],
  categories: [{ id: 'c1', inventory_id: 'inv', name: 'Dry' }],
  tags: [{ id: 't1', inventory_id: 'inv', name: 'Bulk' }],
  products: [
    { id: 'p1', inventory_id: 'inv', name: 'Rice', quantity: '3.000', category_id: 'c1', archived_at: null },
    { id: 'p2', inventory_id: 'demo', name: 'Never moved', quantity: 0, category_id: null, archived_at: null },
  ],
  product_tags: [{ product_id: 'p1', tag_id: 't1', inventory_id: 'inv' }],
  stock_movements: [
    { id: 'm1', product_id: 'p1', created_at: '2026-11-01T10:00:00Z', delta: '5.000', quantity_before: '0.000', quantity_after: '5.000' },
    { id: 'm2', product_id: 'p1', created_at: '2026-11-02T10:00:00Z', delta: -2, quantity_before: 5, quantity_after: 3 },
  ],
  transfers: [],
  transfer_lines: [],
})

describe('validateBackup', () => {
  it('accepts a consistent backup and summarises it per inventory', () => {
    const r = validateBackup(doc())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.counts).toEqual({ inventories: 2, products: 2, movements: 2, categories: 1, tags: 1, transfers: 0 })
    expect(r.inventories).toEqual([
      { id: 'inv', name: 'Main', isDemo: false, products: 1, movements: 2 },
      { id: 'demo', name: 'Demo', isDemo: true, products: 1, movements: 0 },
    ])
  })

  it('rejects other files and other versions with a clear message', () => {
    expect(validateBackup({ hello: 'world' })).toMatchObject({ ok: false })
    expect(validateBackup({ ...doc(), format: 'csv' })).toEqual({ ok: false, errors: ['This file is not an AuraStock backup.'] })
    expect(validateBackup({ ...doc(), version: 2 })).toEqual({ ok: false, errors: ['Unsupported backup version 2.'] })
  })

  it('detects a tampered stock history', () => {
    const d = doc()
    d.stock_movements[1]!.delta = -1
    const r = validateBackup(d)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join(' ')).toMatch(/Stock history of "Rice" does not add up/)
  })

  it('detects a quantity that does not match the history', () => {
    const d = doc()
    d.products[0]!.quantity = '4'
    const r = validateBackup(d)
    expect(r.ok === false && r.errors[0]).toBe('"Rice" has quantity 4 but its history adds up to 3.')
  })

  it('detects broken references', () => {
    const d = doc()
    d.products[0]!.inventory_id = 'gone'
    d.product_tags[0]!.tag_id = 'nope'
    const r = validateBackup(d)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual(expect.arrayContaining(['Product "Rice" belongs to a missing inventory.', 'A product tag link refers to a missing product or tag.']))
  })

  it('orders movements that share a timestamp by their balance chain', () => {
    const d = doc()
    for (const m of d.stock_movements) m.created_at = '2026-11-01T10:00:00Z'
    d.stock_movements.reverse()
    expect(validateBackup(d).ok).toBe(true)
  })
})

describe('helpers', () => {
  it('computes SHA-256 as lower-case hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('measures UTF-8 size', () => {
    expect(utf8Size('é')).toBe(2)
    expect(utf8Size('abc')).toBe(3)
  })
  it('makes safe file names', () => {
    expect(backupFileName('Acme Foods & Co', new Date('2026-11-18T10:05:00Z'), 'abcdef12-3456')).toBe('aurastock-acme-foods-co-2026-11-18-10-05-abcdef12.json')
  })
  it('prunes only automatic backups beyond the newest ones', () => {
    const records = [
      { id: 'm', kind: 'manual', created_at: '2026-01-01T00:00:00Z' },
      ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, kind: 'automatic', created_at: `2026-11-0${i + 1}T00:00:00Z` })),
    ]
    expect(backupsToPrune(records, 2).map((r) => r.id)).toEqual(['a1', 'a0'])
  })
})
