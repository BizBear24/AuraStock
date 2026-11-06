import { evaluateMovement, type MovementType } from '@/domain/stock'
import { classifyError } from '@/domain/sync'
import * as remote from '@/features/products/remote'
import type { ProductFormValues } from '@/features/products/schema'
import type { Product } from '@/features/products/types'
import { recordMovement } from '@/features/stock/api'
import { offlineDb } from './db'
import type { SyncEngine } from './engine'
import { refreshProduct } from './executors'
import { applyValues, listCategoriesLocal, listTagsLocal, newLocalProduct, putPendingProduct } from './local'
import { isOnline } from './resilient'

/**
 * `synced`  the server has confirmed the change.
 * `queued`  the change is stored on this device only and will be sent when possible. Never present it as saved on the server.
 */
export type SubmitResult = { status: 'synced' } | { status: 'queued' }

export interface MovementInput {
  product: Product
  type: MovementType
  amount: number
  reference: string | null
  note: string | null
  /** One id per user action; reusing it makes retries safe. */
  operationId: string
}

export interface ProductInput {
  inventoryId: string
  /** Existing product to edit, or null to create. */
  product: Product | null
  /** Client-generated id used for a new product. */
  newProductId: string
  values: ProductFormValues
  operationId: string
}

/**
 * Online-first writes with an offline queue. When the server is reachable the user gets its answer
 * immediately (including rejections such as "Insufficient stock"). If the connection is down, or drops
 * mid-request, the operation is stored durably with the same idempotency key and replayed later.
 */
export class OfflineClient {
  private readonly engine: SyncEngine
  private readonly userId: string

  constructor(engine: SyncEngine, userId: string) {
    this.engine = engine
    this.userId = userId
  }

  private flushInBackground(): void {
    this.engine.flush().catch((e: unknown) => console.error('[offline] background sync failed', e))
  }

  async submitMovement(input: MovementInput): Promise<SubmitResult> {
    const { product, type, amount, reference, note, operationId } = input
    if (isOnline()) {
      try {
        await recordMovement({ productId: product.id, type, amount, operationId, reference, note })
        await refreshProduct(product.id)
        return { status: 'synced' }
      } catch (e) {
        if (classifyError(e) !== 'network') throw e
      }
    }
    // Offline: validate against the projected quantity so obvious mistakes are caught immediately.
    const check = evaluateMovement(type, amount, {
      current: product.quantity,
      archived: Boolean(product.archived_at),
      expiresOn: product.expires_on,
      note,
    })
    if (!check.ok) throw new Error(check.reason)
    await this.engine.enqueue({
      id: operationId,
      kind: 'stock_movement',
      inventoryId: product.inventory_id,
      userId: this.userId,
      productId: product.id,
      payload: { type, amount, reference, note, localDelta: check.delta, productName: product.name },
    })
    this.flushInBackground()
    return { status: 'queued' }
  }

  async submitProduct(input: ProductInput): Promise<{ result: SubmitResult; productId: string }> {
    const { inventoryId, product, newProductId, values, operationId } = input
    const productId = product?.id ?? newProductId
    const mode = product ? 'update' : 'create'
    const baseVersion = product?.details_version ?? null

    if (isOnline()) {
      try {
        await remote.saveProduct({ inventoryId, userId: this.userId, id: productId, create: mode === 'create', baseVersion, values })
        await refreshProduct(productId)
        return { result: { status: 'synced' }, productId }
      } catch (e) {
        if (classifyError(e) !== 'network') throw e
      }
    }

    const [categories, tags] = await Promise.all([listCategoriesLocal(inventoryId), listTagsLocal(inventoryId)])
    const base = product ?? newLocalProduct(productId, inventoryId)
    // Keep the overlay and the queue entry consistent: both or neither.
    const db = offlineDb()
    await db.transaction('rw', db.products, db.outbox, async () => {
      await putPendingProduct(applyValues(base, values, tags, categories))
      const added = await this.engine.enqueue({
        id: operationId,
        kind: 'product_save',
        inventoryId,
        userId: this.userId,
        productId,
        payload: { mode, values, baseVersion, productName: values.name },
      })
      if (!added) return
    })
    this.flushInBackground()
    return { result: { status: 'queued' }, productId }
  }
}
