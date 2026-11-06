import { escapeLike } from '@/domain/scan'
import { addDays, parseNameList, sanitizeSearch, toDateString, DEFAULT_EXPIRY_WINDOW_DAYS } from '@/domain/product-status'
import { supabase } from '@/lib/supabase'
import {
  PAGE_SIZE,
  type Category,
  type CategoryStock,
  type InventorySummary,
  type Product,
  type ProductFilters,
  type Tag,
} from './types'
import type { ProductFormValues } from './schema'

export const PRODUCT_COLUMNS =
  'id, inventory_id, name, sku, barcode, qr_code, description, category_id, quantity, unit, min_stock, expires_on, archived_at, created_at, updated_at, stock_state, details_version, category:categories(name), product_tags(tags(id, name))'

export async function listProducts(f: ProductFilters): Promise<{ rows: Product[]; total: number }> {
  const hasTag = f.tagId !== ''
  const select = hasTag ? `${PRODUCT_COLUMNS}, tag_filter:product_tags!inner(tag_id)` : PRODUCT_COLUMNS
  let q = supabase.from('products').select(select, { count: 'exact' }).eq('inventory_id', f.inventoryId)

  q = f.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
  const term = sanitizeSearch(f.search)
  if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
  if (f.categoryId) q = q.eq('category_id', f.categoryId)
  if (hasTag) q = q.eq('tag_filter.tag_id', f.tagId)
  if (f.state !== 'all') q = q.eq('stock_state', f.state)

  const today = new Date()
  if (f.expiry === 'expired') q = q.lt('expires_on', toDateString(today))
  if (f.expiry === 'expiring') {
    q = q.gte('expires_on', toDateString(today)).lte('expires_on', toDateString(addDays(today, DEFAULT_EXPIRY_WINDOW_DAYS)))
  }

  const from = f.page * PAGE_SIZE
  const { data, error, count } = await q
    .order(f.sort, { ascending: f.ascending, nullsFirst: false })
    .order('id')
    .range(from, from + PAGE_SIZE - 1)
    .returns<Product[]>()
  if (error) throw error
  return { rows: data, total: count ?? 0 }
}

export async function getProduct(id: string): Promise<Product> {
  const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).eq('id', id).single<Product>()
  if (error) throw error
  return data
}

export async function listCategories(inventoryId: string): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, name').eq('inventory_id', inventoryId).order('name').returns<Category[]>()
  if (error) throw error
  return data
}

export async function listTags(inventoryId: string): Promise<Tag[]> {
  const { data, error } = await supabase.from('tags').select('id, name').eq('inventory_id', inventoryId).order('name').returns<Tag[]>()
  if (error) throw error
  return data
}

async function resolveCategory(inventoryId: string, name: string | null): Promise<string | null> {
  if (!name) return null
  const { data: existing, error } = await supabase
    .from('categories')
    .select('id')
    .eq('inventory_id', inventoryId)
    .ilike('name', name.replace(/[%_\\]/g, '\\$&'))
    .maybeSingle<{ id: string }>()
  if (error) throw error
  if (existing) return existing.id
  const { data, error: insertError } = await supabase
    .from('categories')
    .insert({ inventory_id: inventoryId, name })
    .select('id')
    .single<{ id: string }>()
  if (insertError) throw insertError
  return data.id
}

async function resolveTagIds(inventoryId: string, names: string[]): Promise<string[]> {
  if (names.length === 0) return []
  const existing = await listTags(inventoryId)
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]))
  const ids: string[] = []
  for (const name of names) {
    const found = byName.get(name.toLowerCase())
    if (found) {
      ids.push(found)
      continue
    }
    const { data, error } = await supabase.from('tags').insert({ inventory_id: inventoryId, name }).select('id').single<{ id: string }>()
    if (error) throw error
    ids.push(data.id)
  }
  return ids
}

async function syncTags(inventoryId: string, productId: string, tagNames: string[]): Promise<void> {
  const wanted = new Set(await resolveTagIds(inventoryId, tagNames))
  const { data, error } = await supabase.from('product_tags').select('tag_id').eq('product_id', productId).returns<{ tag_id: string }[]>()
  if (error) throw error
  const current = new Set(data.map((r) => r.tag_id))
  const toRemove = [...current].filter((id) => !wanted.has(id))
  const toAdd = [...wanted].filter((id) => !current.has(id))
  if (toRemove.length) {
    const { error: e } = await supabase.from('product_tags').delete().eq('product_id', productId).in('tag_id', toRemove)
    if (e) throw e
  }
  if (toAdd.length) {
    const { error: e } = await supabase
      .from('product_tags')
      .insert(toAdd.map((tag_id) => ({ product_id: productId, tag_id, inventory_id: inventoryId })))
    if (e) throw e
  }
}

/** The product's details changed on the server since the version this edit was based on. */
export class ConflictError extends Error {
  constructor(message = 'This product was changed by someone else since you loaded it.') {
    super(message)
    this.name = 'ConflictError'
  }
}

export async function saveProduct(input: {
  inventoryId: string
  userId: string
  /** Existing product to update, or the client-generated id for a new one (see `create`). */
  id?: string
  /** Insert a new product using `id` (idempotent: re-running after success is a no-op). */
  create?: boolean
  /** details_version the edit was based on; the update is rejected with ConflictError if it moved on. */
  baseVersion?: number | null
  values: ProductFormValues
}): Promise<string> {
  const { inventoryId, userId, id, values, create, baseVersion } = input
  const categoryId = await resolveCategory(inventoryId, values.category)
  const fields = {
    name: values.name,
    sku: values.sku,
    barcode: values.barcode,
    qr_code: values.qr_code,
    description: values.description,
    category_id: categoryId,
    unit: values.unit,
    min_stock: values.min_stock,
    expires_on: values.expires_on,
  }
  let productId = id
  if (id && !create) {
    let q = supabase.from('products').update(fields).eq('id', id)
    if (baseVersion != null) q = q.eq('details_version', baseVersion)
    const { data, error } = await q.select('id')
    if (error) throw error
    if (baseVersion != null && data.length === 0) throw new ConflictError()
  } else {
    const { data, error } = await supabase
      .from('products')
      .insert({ ...(id ? { id } : {}), ...fields, inventory_id: inventoryId, created_by: userId })
      .select('id')
      .single<{ id: string }>()
    // 23505 on the primary key means an earlier attempt already created it: treat as success.
    if (error && !(create && error.code === '23505' && error.message.includes('products_pkey'))) throw error
    productId = data?.id ?? id
  }
  if (!productId) throw new Error('Product id missing after save')
  await syncTags(inventoryId, productId, parseNameList(values.tags))
  return productId
}

export async function setArchived(ids: string[], archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .in('id', ids)
  if (error) throw error
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

export async function bulkSetCategory(inventoryId: string, ids: string[], categoryName: string | null): Promise<void> {
  const categoryId = await resolveCategory(inventoryId, categoryName)
  const { error } = await supabase.from('products').update({ category_id: categoryId }).in('id', ids)
  if (error) throw error
}

/** Copies descriptive fields and tags. SKU/barcode/QR are cleared (they must be unique) and stock starts at zero. */
export async function duplicateProduct(product: Product, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      inventory_id: product.inventory_id,
      name: `${product.name} (copy)`.slice(0, 200),
      description: product.description,
      category_id: product.category_id,
      unit: product.unit,
      min_stock: product.min_stock,
      expires_on: product.expires_on,
      created_by: userId,
    })
    .select('id')
    .single<{ id: string }>()
  if (error) throw error
  const tagNames = product.product_tags.flatMap((t) => (t.tags ? [t.tags.name] : []))
  await syncTags(product.inventory_id, data.id, tagNames)
  return data.id
}

export async function fetchSummary(inventoryId: string): Promise<InventorySummary> {
  const { data, error } = await supabase
    .rpc('inventory_summary', { inv: inventoryId, expiry_window_days: DEFAULT_EXPIRY_WINDOW_DAYS })
    .single<InventorySummary>()
  if (error) throw error
  return data
}

export async function fetchCategoryStock(inventoryId: string): Promise<CategoryStock[]> {
  const { data, error } = await supabase.rpc('category_stock', { inv: inventoryId })
  if (error) throw error
  return (data ?? []) as CategoryStock[]
}

/**
 * Find a product by scanned code. Match priority: barcode, then QR value, then SKU (case-insensitive).
 * Archived products are returned too so the scan screen can say so instead of "not found".
 */
export async function findProductByCode(inventoryId: string, code: string): Promise<Product | null> {
  const base = () => supabase.from('products').select(PRODUCT_COLUMNS).eq('inventory_id', inventoryId).limit(1)
  const [byBarcode, byQr, bySku] = await Promise.all([
    base().eq('barcode', code).returns<Product[]>(),
    base().eq('qr_code', code).returns<Product[]>(),
    base().ilike('sku', escapeLike(code)).returns<Product[]>(),
  ])
  for (const r of [byBarcode, byQr, bySku]) {
    if (r.error) throw r.error
  }
  return byBarcode.data?.[0] ?? byQr.data?.[0] ?? bySku.data?.[0] ?? null
}

/** One page of products ordered by updated_at, for filling the offline cache. */
export async function fetchProductsChunk(
  inventoryId: string,
  since: string | null,
  offset: number,
  limit: number,
): Promise<Product[]> {
  let q = supabase.from('products').select(PRODUCT_COLUMNS).eq('inventory_id', inventoryId)
  if (since) q = q.gte('updated_at', since)
  const { data, error } = await q
    .order('updated_at', { ascending: true })
    .order('id')
    .range(offset, offset + limit - 1)
    .returns<Product[]>()
  if (error) throw error
  return data
}
