/**
 * Product data access used by the UI. Reads go to the server when reachable (and refresh the on-device
 * cache), and fall back to the cache when offline. Writes that must work offline go through
 * `OfflineClient` (src/offline/client.ts); archive, delete, duplicate and bulk edits need a connection.
 */
import * as local from '@/offline/local'
import { readThrough } from '@/offline/resilient'
import * as remote from './remote'
import type { Category, CategoryStock, InventorySummary, Product, ProductFilters, Tag } from './types'

export * from './types'
export { bulkSetCategory, deleteProduct, duplicateProduct, setArchived } from './remote'

export function listProducts(f: ProductFilters): Promise<{ rows: Product[]; total: number }> {
  return readThrough(
    async () => {
      const result = await remote.listProducts(f)
      local.bestEffort(local.cacheProducts(result.rows), 'cache products')
      return { rows: await local.overlayPending(result.rows), total: result.total }
    },
    () => local.listProductsLocal(f),
  )
}

export function getProduct(id: string): Promise<Product> {
  const fromCache = async () => {
    const row = await local.getProductLocal(id)
    if (!row) throw new Error('This product is not available offline yet.')
    return row
  }
  return readThrough(async () => {
    try {
      const product = await remote.getProduct(id)
      local.bestEffort(local.cacheProducts([product]), 'cache product')
      return (await local.overlayPending([product]))[0] ?? product
    } catch (e) {
      // A product created offline does not exist on the server until its operation syncs.
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'PGRST116') {
        const row = await local.getProductLocal(id)
        if (row) return row
      }
      throw e
    }
  }, fromCache)
}

export function findProductByCode(inventoryId: string, code: string): Promise<Product | null> {
  return readThrough(
    async () => {
      const found = await remote.findProductByCode(inventoryId, code)
      if (!found) return local.findProductByCodeLocal(inventoryId, code) // may be queued locally
      local.bestEffort(local.cacheProducts([found]), 'cache product')
      return (await local.overlayPending([found]))[0] ?? found
    },
    () => local.findProductByCodeLocal(inventoryId, code),
  )
}

export function listCategories(inventoryId: string): Promise<Category[]> {
  return readThrough(() => remote.listCategories(inventoryId), () => local.listCategoriesLocal(inventoryId))
}

export function listTags(inventoryId: string): Promise<Tag[]> {
  return readThrough(() => remote.listTags(inventoryId), () => local.listTagsLocal(inventoryId))
}

export function fetchSummary(inventoryId: string): Promise<InventorySummary> {
  return readThrough(() => remote.fetchSummary(inventoryId), () => local.summaryLocal(inventoryId))
}

export function fetchCategoryStock(inventoryId: string): Promise<CategoryStock[]> {
  return readThrough(() => remote.fetchCategoryStock(inventoryId), () => local.categoryStockLocal(inventoryId))
}
