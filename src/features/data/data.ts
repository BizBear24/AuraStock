import { movementsTable, productsTable, type ExportMovement, type Table } from '@/domain/export'
import type { ImportRow } from '@/domain/import'
import * as remote from '@/features/products/remote'
import type { Product, ProductFilters } from '@/features/products/types'
import { fetchMovementsPage, type Movement } from '@/features/stock/api'
import { listProductsLocal } from '@/offline/local'
import { readThrough } from '@/offline/resilient'
import { supabase } from '@/lib/supabase'

const CHUNK = 500

/** Every product of an inventory (archived included). Falls back to the on-device copy when offline. */
export function fetchAllProducts(inventoryId: string): Promise<Product[]> {
  return readThrough(
    async () => {
      const all: Product[] = []
      for (let offset = 0; ; offset += CHUNK) {
        const chunk = await remote.fetchProductsChunk(inventoryId, null, offset, CHUNK)
        all.push(...chunk)
        if (chunk.length < CHUNK) return all
      }
    },
    async () => {
      const filters: Omit<ProductFilters, 'page' | 'archived'> = { inventoryId, search: '', categoryId: '', tagId: '', state: 'all', expiry: 'all', sort: 'name', ascending: true }
      const [active, archived] = await Promise.all([
        listAllLocal({ ...filters, archived: false }),
        listAllLocal({ ...filters, archived: true }),
      ])
      return [...active, ...archived]
    },
  )
}

async function listAllLocal(filters: Omit<ProductFilters, 'page'>): Promise<Product[]> {
  const out: Product[] = []
  for (let page = 0; ; page += 1) {
    const { rows, total } = await listProductsLocal({ ...filters, page })
    out.push(...rows)
    if (out.length >= total || rows.length === 0) return out
  }
}

/** All movements in [from, to) as ISO timestamps. Online only. */
export async function fetchAllMovements(inventoryId: string, fromIso: string | null, toIso: string | null): Promise<Movement[]> {
  const all: Movement[] = []
  for (let offset = 0; ; offset += 1000) {
    const chunk = await fetchMovementsPage(inventoryId, fromIso, toIso, offset, 1000)
    all.push(...chunk)
    if (chunk.length < 1000) return all
  }
}

export function movementExportRows(rows: Movement[]): ExportMovement[] {
  return rows.map((m) => ({
    created_at: m.created_at,
    product_name: m.product?.name ?? null,
    sku: m.product?.sku ?? null,
    movement_type: m.movement_type,
    delta: m.delta,
    quantity_before: m.quantity_before,
    quantity_after: m.quantity_after,
    reference: m.reference,
    note: m.note,
    user: m.author?.full_name ?? m.author?.email ?? null,
  }))
}

export async function buildProductsTable(inventoryId: string): Promise<Table> {
  return productsTable(await fetchAllProducts(inventoryId))
}

export async function buildMovementsTable(inventoryId: string, fromIso: string | null, toIso: string | null): Promise<Table> {
  return movementsTable(movementExportRows(await fetchAllMovements(inventoryId, fromIso, toIso)))
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
}

/** Commit validated rows atomically. `operationId` makes the opening-stock movements idempotent. */
export async function importProducts(input: { inventoryId: string; rows: ImportRow[]; updateExisting: boolean; operationId: string }): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_products', {
    p_inventory: input.inventoryId,
    p_rows: input.rows,
    p_update_existing: input.updateExisting,
    p_operation_id: input.operationId,
  })
  if (error) throw error
  return data as ImportResult
}
