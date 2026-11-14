import { DEFAULT_EXPIRY_WINDOW_DAYS, addDays, expiryState, parseNameList, sanitizeSearch, stockState, toDateString } from '@/domain/product-status'
import { projectQuantity } from '@/domain/sync'
import type { ProductFormValues } from '@/features/products/schema'
import { PAGE_SIZE, type Category, type CategoryStock, type InventorySummary, type Product, type ProductFilters, type Tag } from '@/features/products/types'
import { getMeta, offlineDb, setMeta, type CachedProduct, type OutboxEntry } from './db'

/** Log a non-critical cache failure instead of failing the user's request. */
export function bestEffort(work: Promise<unknown>, label: string): void {
  work.catch((e: unknown) => console.warn(`[offline] ${label} failed`, e))
}

const isOpen = (e: OutboxEntry) => e.status === 'pending' || e.status === 'syncing'

// ------------------------------------------------------------------ cache writes

/** Store server rows, but never overwrite a row that holds unsynced local edits. */
export async function cacheProducts(rows: Product[]): Promise<void> {
  if (rows.length === 0) return
  const db = offlineDb()
  await db.transaction('rw', db.products, async () => {
    const existing = await db.products.bulkGet(rows.map((r) => r.id))
    const protectedIds = new Set(existing.flatMap((r) => (r?._pending ? [r.id] : [])))
    await db.products.bulkPut(rows.filter((r) => !protectedIds.has(r.id)).map((r) => ({ ...r, _pending: false })))
  })
}

export async function cacheTaxonomy(inventoryId: string, categories: Category[], tags: Tag[]): Promise<void> {
  const db = offlineDb()
  await db.transaction('rw', db.categories, db.tags, async () => {
    await db.categories.where('inventory_id').equals(inventoryId).delete()
    await db.tags.where('inventory_id').equals(inventoryId).delete()
    await db.categories.bulkPut(categories.map((c) => ({ ...c, inventory_id: inventoryId })))
    await db.tags.bulkPut(tags.map((t) => ({ ...t, inventory_id: inventoryId })))
  })
}

// ------------------------------------------------------------------ pending overlay

/** Show queued stock movements on top of server-confirmed quantities. */
export async function overlayPending<T extends Product>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows
  const entries = await offlineDb().outbox.where('productId').anyOf(rows.map((r) => r.id)).toArray()
  if (entries.length === 0) return rows
  const byProduct = new Map<string, OutboxEntry[]>()
  for (const e of entries) byProduct.set(e.productId, [...(byProduct.get(e.productId) ?? []), e])
  return rows.map((r) => {
    const own = (byProduct.get(r.id) ?? []).filter(isOpen)
    if (own.length === 0) return r
    const deltas = own.flatMap((e) => (e.kind === 'stock_movement' ? [e.payload.localDelta] : []))
    const quantity = projectQuantity(r.quantity, deltas)
    return { ...r, quantity, stock_state: stockState(quantity, r.min_stock), pending_ops: own.length }
  })
}

// ------------------------------------------------------------------ local reads

function compare(a: Product, b: Product, f: ProductFilters): number {
  const dir = f.ascending ? 1 : -1
  let result: number
  if (f.sort === 'name') result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  else if (f.sort === 'quantity') result = a.quantity - b.quantity
  else {
    const av = f.sort === 'expires_on' ? a.expires_on : a.updated_at
    const bv = f.sort === 'expires_on' ? b.expires_on : b.updated_at
    // Missing dates always sort last, matching the server query.
    if (av == null && bv == null) result = 0
    else if (av == null) return 1
    else if (bv == null) return -1
    else result = av < bv ? -1 : av > bv ? 1 : 0
  }
  return result !== 0 ? result * dir : a.id < b.id ? -1 : 1
}

export async function listProductsLocal(f: ProductFilters): Promise<{ rows: Product[]; total: number }> {
  const cached = await offlineDb().products.where('inventory_id').equals(f.inventoryId).toArray()
  const all = await overlayPending(cached)
  const term = sanitizeSearch(f.search).toLowerCase()
  const today = new Date()
  const todayStr = toDateString(today)
  const soonStr = toDateString(addDays(today, DEFAULT_EXPIRY_WINDOW_DAYS))

  const matched = all.filter((p) => {
    if (f.archived ? p.archived_at == null : p.archived_at != null) return false
    if (term && ![p.name, p.sku, p.barcode].some((v) => v?.toLowerCase().includes(term))) return false
    if (f.categoryId && p.category_id !== f.categoryId) return false
    if (f.tagId && !p.product_tags.some((t) => t.tags?.id === f.tagId)) return false
    if (f.state !== 'all' && p.stock_state !== f.state) return false
    if (f.expiry === 'expired' && !(p.expires_on != null && p.expires_on < todayStr)) return false
    if (f.expiry === 'expiring' && !(p.expires_on != null && p.expires_on >= todayStr && p.expires_on <= soonStr)) return false
    return true
  })
  matched.sort((a, b) => compare(a, b, f))
  const from = f.page * PAGE_SIZE
  return { rows: matched.slice(from, from + PAGE_SIZE), total: matched.length }
}

export async function getProductLocal(id: string): Promise<Product | undefined> {
  const row = await offlineDb().products.get(id)
  return row ? (await overlayPending([row]))[0] : undefined
}

export async function findProductByCodeLocal(inventoryId: string, code: string): Promise<Product | null> {
  const rows = await overlayPending(await offlineDb().products.where('inventory_id').equals(inventoryId).toArray())
  const lower = code.toLowerCase()
  return (
    rows.find((p) => p.barcode === code) ??
    rows.find((p) => p.qr_code === code) ??
    rows.find((p) => p.sku?.toLowerCase() === lower) ??
    null
  )
}

export async function listCategoriesLocal(inventoryId: string): Promise<Category[]> {
  const rows = await offlineDb().categories.where('inventory_id').equals(inventoryId).toArray()
  return rows.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listTagsLocal(inventoryId: string): Promise<Tag[]> {
  const rows = await offlineDb().tags.where('inventory_id').equals(inventoryId).toArray()
  return rows.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

async function activeProducts(inventoryId: string): Promise<Product[]> {
  const rows = await overlayPending(await offlineDb().products.where('inventory_id').equals(inventoryId).toArray())
  return rows.filter((p) => p.archived_at == null)
}

export async function summaryLocal(inventoryId: string): Promise<InventorySummary> {
  const rows = await activeProducts(inventoryId)
  return {
    total_products: rows.length,
    total_units: rows.reduce((s, p) => s + p.quantity, 0),
    low_stock: rows.filter((p) => p.stock_state === 'low').length,
    out_of_stock: rows.filter((p) => p.stock_state === 'out').length,
    expiring: rows.filter((p) => expiryState(p.expires_on) === 'expiring').length,
    expired: rows.filter((p) => expiryState(p.expires_on) === 'expired').length,
  }
}

export async function categoryStockLocal(inventoryId: string): Promise<CategoryStock[]> {
  const groups = new Map<string, CategoryStock>()
  for (const p of await activeProducts(inventoryId)) {
    const key = p.category?.name ?? 'Uncategorized'
    const g = groups.get(key) ?? { category: key, units: 0, products: 0 }
    g.units += p.quantity
    g.products += 1
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.units - a.units)
}

// ------------------------------------------------------------------ optimistic product edits

/** Build the product as it will look once the queued save is applied. */
export function applyValues(base: Product, values: ProductFormValues, knownTags: Tag[], knownCategories: Category[]): Product {
  const tagNames = parseNameList(values.tags)
  const category = values.category ? knownCategories.find((c) => c.name.toLowerCase() === values.category?.toLowerCase()) : undefined
  return {
    ...base,
    name: values.name,
    sku: values.sku,
    barcode: values.barcode,
    qr_code: values.qr_code,
    description: values.description,
    unit: values.unit,
    min_stock: values.min_stock,
    expires_on: values.expires_on,
    category_id: category?.id ?? null,
    category: values.category ? { name: category?.name ?? values.category } : null,
    product_tags: tagNames.map((name) => {
      const known = knownTags.find((t) => t.name.toLowerCase() === name.toLowerCase())
      return { tags: { id: known?.id ?? `local:${name.toLowerCase()}`, name: known?.name ?? name } }
    }),
    stock_state: stockState(base.quantity, values.min_stock),
  }
}

export function newLocalProduct(id: string, inventoryId: string): Product {
  const now = new Date().toISOString()
  return {
    id,
    inventory_id: inventoryId,
    name: '',
    sku: null,
    barcode: null,
    qr_code: null,
    description: null,
    category_id: null,
    quantity: 0,
    unit: 'pcs',
    min_stock: 0,
    expires_on: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    stock_state: 'out',
    category: null,
    product_tags: [],
    details_version: 1,
  }
}

/** Write the optimistic row for a queued save and protect it from being overwritten by a pull. */
export async function putPendingProduct(product: Product): Promise<void> {
  const row: CachedProduct = { ...product, _pending: true }
  await offlineDb().products.put(row)
}

/** Undo local effects of a discarded operation. */
export async function discardLocalEffects(entry: OutboxEntry): Promise<void> {
  if (entry.kind !== 'product_save') return
  const db = offlineDb()
  if (entry.payload.mode === 'create') {
    await db.products.delete(entry.productId)
    return
  }
  // Release the protection so the next refresh restores the server's version.
  await db.products.update(entry.productId, { _pending: false })
}

/** True while some queued product edit still depends on the local row. */
async function hasOpenSave(productId: string): Promise<boolean> {
  const entries = await offlineDb().outbox.where('productId').equals(productId).toArray()
  return entries.some((e) => e.kind === 'product_save' && e.status !== 'failed')
}

/** Store a fresh server row unless local edits are still queued for it. */
export async function storeConfirmed(product: Product): Promise<void> {
  if (await hasOpenSave(product.id)) return
  await offlineDb().products.put({ ...product, _pending: false })
}

// ------------------------------------------------------------------ pulling

const FULL_REFRESH_MS = 24 * 60 * 60 * 1000
const CHUNK = 500

export interface PullSource {
  fetchProductsChunk: (inventoryId: string, since: string | null, offset: number, limit: number) => Promise<Product[]>
  listCategories: (inventoryId: string) => Promise<Category[]>
  listTags: (inventoryId: string) => Promise<Tag[]>
}

/**
 * Bring the on-device cache up to date. Incremental by `updated_at` normally; a full pass at least daily
 * also drops products that no longer exist on the server.
 */
export async function pullInventory(inventoryId: string, source: PullSource, now: () => number = Date.now): Promise<void> {
  const key = `pull:${inventoryId}`
  const state = await getMeta<{ fullAt: number; since: string | null }>(key)
  const full = !state || now() - state.fullAt > FULL_REFRESH_MS
  const since = full ? null : state.since
  const seen = new Set<string>()
  let newest = full ? null : (state?.since ?? null)

  for (let offset = 0; ; offset += CHUNK) {
    const chunk = await source.fetchProductsChunk(inventoryId, since, offset, CHUNK)
    await cacheProducts(chunk)
    for (const p of chunk) {
      seen.add(p.id)
      if (newest === null || p.updated_at > newest) newest = p.updated_at
    }
    if (chunk.length < CHUNK) break
  }

  if (full) {
    const db = offlineDb()
    const stale = (await db.products.where('inventory_id').equals(inventoryId).toArray()).filter((p) => !seen.has(p.id) && !p._pending)
    await db.products.bulkDelete(stale.map((p) => p.id))
  }
  await cacheTaxonomy(inventoryId, await source.listCategories(inventoryId), await source.listTags(inventoryId))
  await setMeta(key, { fullAt: full ? now() : state.fullAt, since: newest })
}

/** Forget everything cached for an inventory that no longer exists (for example after removing demo data). */
export async function purgeInventoryCache(inventoryId: string): Promise<void> {
  const db = offlineDb()
  await db.transaction('rw', db.products, db.categories, db.tags, db.outbox, db.meta, async () => {
    await db.products.where('inventory_id').equals(inventoryId).delete()
    await db.categories.where('inventory_id').equals(inventoryId).delete()
    await db.tags.where('inventory_id').equals(inventoryId).delete()
    await db.outbox.where('inventoryId').equals(inventoryId).delete()
    await db.meta.delete(`pull:${inventoryId}`)
  })
}
