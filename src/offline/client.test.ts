// @vitest-environment node
import 'fake-indexeddb/auto'
import type { ProductFormValues } from '@/features/products/schema'
import { defaultFilters, type Product } from '@/features/products/types'

let online = true
const recordMovement = vi.fn()
const saveProduct = vi.fn()

vi.mock('./resilient', () => ({ isOnline: () => online }))
vi.mock('@/features/stock/api', () => ({ recordMovement: (...a: unknown[]) => recordMovement(...a) }))
vi.mock('@/features/products/remote', () => ({ saveProduct: (...a: unknown[]) => saveProduct(...a), ConflictError: class extends Error {} }))
vi.mock('./executors', () => ({ refreshProduct: async () => null }))

const { closeOfflineDb, offlineDb, openOfflineDb } = await import('./db')
const { SyncEngine } = await import('./engine')
const { OfflineClient } = await import('./client')
const local = await import('./local')

let counter = 0
let engine: InstanceType<typeof SyncEngine>
let client: InstanceType<typeof OfflineClient>

const product = (over: Partial<Product> = {}): Product => ({
  ...local.newLocalProduct('p1', 'inv'),
  name: 'Widget',
  quantity: 8,
  stock_state: 'ok',
  ...over,
})

const values = (over: Partial<ProductFormValues> = {}): ProductFormValues => ({
  name: 'Gadget',
  sku: 'G-1',
  barcode: null,
  qr_code: null,
  description: null,
  category: 'Tools',
  tags: 'Cold, Fragile',
  unit: 'pcs',
  min_stock: 2,
  expires_on: null,
  ...over,
})

beforeEach(async () => {
  online = true
  recordMovement.mockReset()
  saveProduct.mockReset()
  closeOfflineDb()
  const db = openOfflineDb(`client-${++counter}`)
  await db.products.put({ ...product(), _pending: false })
  engine = new SyncEngine({ db, execute: async () => ({ kind: 'done' }), isOnline: () => online })
  client = new OfflineClient(engine, 'user-1')
})

afterEach(async () => {
  await engine.flush() // let any background sync finish before the next test swaps the database
})

describe('OfflineClient.submitMovement', () => {
  it('sends straight to the server when online and does not queue', async () => {
    recordMovement.mockResolvedValue(undefined)
    const r = await client.submitMovement({ product: product(), type: 'out', amount: 3, reference: null, note: null, operationId: 'op-1' })
    expect(r.status).toBe('synced')
    expect(recordMovement).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-1', amount: 3 }))
    expect(await engine.list()).toHaveLength(0)
  })

  it('surfaces server rejections instead of queueing them', async () => {
    recordMovement.mockRejectedValue({ message: 'Insufficient stock: 8 available, 10 requested', code: '23514' })
    await expect(client.submitMovement({ product: product(), type: 'out', amount: 10, reference: null, note: null, operationId: 'op-2' })).rejects.toMatchObject({
      code: '23514',
    })
    expect(await engine.list()).toHaveLength(0)
  })

  it('queues with the same idempotency key when the connection drops mid-request', async () => {
    recordMovement.mockRejectedValue(new TypeError('Failed to fetch'))
    const r = await client.submitMovement({ product: product(), type: 'out', amount: 3, reference: null, note: null, operationId: 'op-3' })
    expect(r.status).toBe('queued')
    expect((await engine.list()).map((e) => e.id)).toEqual(['op-3'])
  })

  it('queues while offline and shows the projected quantity', async () => {
    online = false
    const r = await client.submitMovement({ product: product(), type: 'out', amount: 5, reference: 'PO-1', note: null, operationId: 'op-4' })
    expect(r.status).toBe('queued')
    expect(recordMovement).not.toHaveBeenCalled()
    const shown = await local.getProductLocal('p1')
    expect(shown?.quantity).toBe(3)
    expect(shown?.pending_ops).toBe(1)
    expect(shown?.stock_state).toBe('ok')
  })

  it('rejects offline overdraws against the projected quantity', async () => {
    online = false
    await client.submitMovement({ product: product(), type: 'out', amount: 5, reference: null, note: null, operationId: 'a' })
    const projected = (await local.getProductLocal('p1')) as Product
    await expect(client.submitMovement({ product: projected, type: 'out', amount: 5, reference: null, note: null, operationId: 'b' })).rejects.toThrow(
      /Insufficient stock: 3 available, 5 requested/,
    )
    expect(await engine.list()).toHaveLength(1)
  })

  it('ignores a double submit of the same operation', async () => {
    online = false
    const input = { product: product(), type: 'in' as const, amount: 2, reference: null, note: null, operationId: 'same' }
    await client.submitMovement(input)
    await client.submitMovement(input)
    expect(await engine.list()).toHaveLength(1)
  })
})

describe('OfflineClient.submitProduct', () => {
  it('creates a product offline: visible locally, queued once, protected from pulls', async () => {
    online = false
    const result = await client.submitProduct({ inventoryId: 'inv', product: null, newProductId: 'new-1', values: values(), operationId: 'save-1' })
    expect(result).toMatchObject({ result: { status: 'queued' }, productId: 'new-1' })
    const list = await local.listProductsLocal({ ...defaultFilters('inv'), search: 'gadget' })
    expect(list.rows.map((p) => p.name)).toEqual(['Gadget'])
    expect(list.rows[0]?.product_tags.map((t) => t.tags?.name)).toEqual(['Cold', 'Fragile'])
    expect((await engine.list())[0]).toMatchObject({ kind: 'product_save', productId: 'new-1', payload: { mode: 'create', baseVersion: null } })

    // A pull that returns an older server row must not wipe the unsynced local edit.
    await local.cacheProducts([{ ...local.newLocalProduct('new-1', 'inv'), name: 'Server copy' }])
    expect((await local.getProductLocal('new-1'))?.name).toBe('Gadget')
  })

  it('queues an edit with the version it was based on', async () => {
    online = false
    await client.submitProduct({ inventoryId: 'inv', product: product({ details_version: 4 }), newProductId: 'x', values: values({ name: 'Renamed' }), operationId: 'save-2' })
    expect((await engine.list())[0]).toMatchObject({ payload: { mode: 'update', baseVersion: 4 } })
    expect((await local.getProductLocal('p1'))?.name).toBe('Renamed')
  })

  it('discarding a queued create removes the local row', async () => {
    online = false
    await client.submitProduct({ inventoryId: 'inv', product: null, newProductId: 'new-2', values: values(), operationId: 'save-3' })
    const [entry] = await engine.list()
    await offlineDb().outbox.clear()
    await local.discardLocalEffects(entry!)
    expect(await local.getProductLocal('new-2')).toBeUndefined()
  })

  it('goes straight to the server when online', async () => {
    saveProduct.mockResolvedValue('new-3')
    const r = await client.submitProduct({ inventoryId: 'inv', product: null, newProductId: 'new-3', values: values(), operationId: 'save-4' })
    expect(r.result.status).toBe('synced')
    expect(saveProduct).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-3', create: true }))
    expect(await engine.list()).toHaveLength(0)
  })
})

describe('pullInventory', () => {
  const row = (id: string, updated: string, name = id): Product => ({ ...local.newLocalProduct(id, 'inv'), name, updated_at: updated })

  it('fills the cache, then fetches incrementally, and prunes deleted products on full refresh', async () => {
    let clock = 1_000
    const calls: (string | null)[] = []
    let server = [row('a', '2026-01-01T00:00:00Z'), row('b', '2026-01-02T00:00:00Z')]
    const source = {
      fetchProductsChunk: async (_inv: string, since: string | null) => {
        calls.push(since)
        return server.filter((p) => !since || p.updated_at >= since)
      },
      listCategories: async () => [{ id: 'c1', name: 'Tools' }],
      listTags: async () => [{ id: 't1', name: 'Cold' }],
    }
    await local.pullInventory('inv', source, () => clock)
    expect((await offlineDb().products.where('inventory_id').equals('inv').toArray()).map((p) => p.id).sort()).toEqual(['a', 'b']) // the stale local-only row 'p1' is pruned by the full refresh
    expect(await local.listCategoriesLocal('inv')).toEqual([{ id: 'c1', name: 'Tools' }])

    server = [row('a', '2026-01-01T00:00:00Z'), row('b', '2026-01-02T00:00:00Z', 'b renamed'), row('c', '2026-01-03T00:00:00Z')]
    clock += 60_000
    await local.pullInventory('inv', source, () => clock)
    expect(calls).toEqual([null, '2026-01-02T00:00:00Z'])
    expect((await local.getProductLocal('b'))?.name).toBe('b renamed')
    expect(await local.getProductLocal('c')).toBeDefined()

    server = [row('c', '2026-01-03T00:00:00Z')]
    clock += 25 * 60 * 60 * 1000
    await local.pullInventory('inv', source, () => clock)
    expect(calls.at(-1)).toBeNull()
    expect(await local.getProductLocal('a')).toBeUndefined()
    expect(await local.getProductLocal('p1')).toBeUndefined()
  })
})

describe('listProductsLocal', () => {
  it('filters, sorts and pages like the server query', async () => {
    const db = offlineDb()
    await db.products.bulkPut([
      { ...product({ id: 'q1', name: 'banana', quantity: 0, stock_state: 'out', sku: 'B-1' }), _pending: false },
      { ...product({ id: 'q2', name: 'Apple', quantity: 1, min_stock: 5, stock_state: 'low', barcode: '999' }), _pending: false },
      { ...product({ id: 'q3', name: 'cherry', archived_at: '2026-01-01T00:00:00Z' }), _pending: false },
    ])
    const f = defaultFilters('inv')
    expect((await local.listProductsLocal(f)).rows.map((p) => p.name)).toEqual(['Apple', 'banana', 'Widget'])
    expect((await local.listProductsLocal({ ...f, state: 'low' })).rows.map((p) => p.id)).toEqual(['q2'])
    expect((await local.listProductsLocal({ ...f, search: '999' })).rows.map((p) => p.id)).toEqual(['q2'])
    expect((await local.listProductsLocal({ ...f, search: 'b-1' })).rows.map((p) => p.id)).toEqual(['q1'])
    expect((await local.listProductsLocal({ ...f, archived: true })).rows.map((p) => p.id)).toEqual(['q3'])
    expect((await local.listProductsLocal({ ...f, sort: 'quantity', ascending: false })).rows[0]?.id).toBe('p1')
    expect((await local.findProductByCodeLocal('inv', '999'))?.id).toBe('q2')
    expect((await local.findProductByCodeLocal('inv', 'b-1'))?.id).toBe('q1')
    expect((await local.summaryLocal('inv')).out_of_stock).toBe(1)
  })
})
