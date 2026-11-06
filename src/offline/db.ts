import Dexie, { type Table } from 'dexie'
import type { MovementType } from '@/domain/stock'
import type { Category, Product, Tag } from '@/features/products/types'
import type { ProductFormValues } from '@/features/products/schema'

export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'conflict'

export interface StockMovementPayload {
  type: MovementType
  amount: number
  reference: string | null
  note: string | null
  /** Effect on quantity computed when queued; used only to display a projected quantity. */
  localDelta: number
  productName: string
}

export interface ProductSavePayload {
  mode: 'create' | 'update'
  values: ProductFormValues
  /** details_version the edit was based on (null for creates). */
  baseVersion: number | null
  productName: string
}

interface OutboxBase {
  /** Auto-increment order; operations are applied in this order. */
  seq?: number
  /** Operation id, also the server-side idempotency key. Unique. */
  id: string
  inventoryId: string
  userId: string
  productId: string
  status: OutboxStatus
  attempts: number
  lastError: string | null
  nextAttemptAt: number
  createdAt: number
  /** Server details_version observed when a conflict was detected. */
  serverVersion?: number | null
}

export type OutboxEntry =
  | (OutboxBase & { kind: 'stock_movement'; payload: StockMovementPayload })
  | (OutboxBase & { kind: 'product_save'; payload: ProductSavePayload })

type NewBase = Pick<OutboxBase, 'id' | 'inventoryId' | 'userId' | 'productId'>
export type NewOutboxEntry =
  | (NewBase & { kind: 'stock_movement'; payload: StockMovementPayload })
  | (NewBase & { kind: 'product_save'; payload: ProductSavePayload })

/** Cached server row. `_pending` marks a row holding unsynced local edits (never overwritten by a pull). */
export type CachedProduct = Product & { _pending?: boolean }
export type CachedCategory = Category & { inventory_id: string }
export type CachedTag = Tag & { inventory_id: string }

export interface MetaRow {
  key: string
  value: unknown
}

/** One database per signed-in user, so people sharing a device never see each other's data or queue. */
export class OfflineDb extends Dexie {
  declare outbox: Table<OutboxEntry, number>
  declare products: Table<CachedProduct, string>
  declare categories: Table<CachedCategory, string>
  declare tags: Table<CachedTag, string>
  declare meta: Table<MetaRow, string>

  constructor(userId: string) {
    super(`aurastock-${userId}`)
    this.version(1).stores({
      outbox: '++seq, &id, status, productId, inventoryId',
      products: 'id, inventory_id',
      categories: 'id, inventory_id',
      tags: 'id, inventory_id',
      meta: 'key',
    })
  }
}

let active: OfflineDb | null = null

/** Select the database for the signed-in user. Called once by the offline provider. */
export function openOfflineDb(userId: string): OfflineDb {
  if (active?.name === `aurastock-${userId}`) return active
  active?.close()
  active = new OfflineDb(userId)
  return active
}

export function offlineDb(): OfflineDb {
  if (!active) throw new Error('Offline database is not open')
  return active
}

export function closeOfflineDb(): void {
  active?.close()
  active = null
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await offlineDb().meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await offlineDb().meta.put({ key, value })
}
