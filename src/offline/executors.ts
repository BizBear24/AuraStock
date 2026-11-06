import { parseNameList } from '@/domain/product-status'
import type { ProductFormValues } from '@/features/products/schema'
import * as remote from '@/features/products/remote'
import type { Product } from '@/features/products/types'
import { recordMovement } from '@/features/stock/api'
import type { OutboxEntry } from './db'
import type { ExecResult } from './engine'
import { storeConfirmed } from './local'

/** True when the server row already holds exactly the values of a queued edit (a replay of an applied save). */
export function serverMatches(server: Product, values: ProductFormValues): boolean {
  const names = (list: string[]) => [...list].map((n) => n.toLowerCase()).sort().join('|')
  return (
    server.name === values.name &&
    server.sku === values.sku &&
    server.barcode === values.barcode &&
    server.qr_code === values.qr_code &&
    server.description === values.description &&
    server.unit === values.unit &&
    server.min_stock === values.min_stock &&
    server.expires_on === values.expires_on &&
    (server.category?.name ?? '').toLowerCase() === (values.category ?? '').toLowerCase() &&
    names(server.product_tags.flatMap((t) => (t.tags ? [t.tags.name] : []))) === names(parseNameList(values.tags))
  )
}

/** Refresh the cached copy of a product from the server. Cache problems never fail the operation. */
export async function refreshProduct(id: string): Promise<Product | null> {
  try {
    const fresh = await remote.getProduct(id)
    await storeConfirmed(fresh)
    return fresh
  } catch (e) {
    console.warn('[offline] could not refresh product after sync', e)
    return null
  }
}

/** Send one queued operation to the server. Throws on failure; the engine classifies the error. */
export async function executeEntry(entry: OutboxEntry): Promise<ExecResult> {
  if (entry.kind === 'stock_movement') {
    const p = entry.payload
    // `entry.id` is the idempotency key: replays return the original movement instead of applying twice.
    await recordMovement({ productId: entry.productId, type: p.type, amount: p.amount, operationId: entry.id, reference: p.reference, note: p.note })
    await refreshProduct(entry.productId)
    return { kind: 'done' }
  }

  const { mode, values, baseVersion } = entry.payload
  try {
    await remote.saveProduct({
      inventoryId: entry.inventoryId,
      userId: entry.userId,
      id: entry.productId,
      create: mode === 'create',
      baseVersion: mode === 'update' ? baseVersion : null,
      values,
    })
  } catch (e) {
    if (!(e instanceof remote.ConflictError)) throw e
    const server = await remote.getProduct(entry.productId)
    // The first attempt may have succeeded before the connection dropped: nothing left to do then.
    if (serverMatches(server, values)) {
      await refreshProduct(entry.productId)
      return { kind: 'done', detailsVersion: server.details_version }
    }
    return {
      kind: 'conflict',
      message: 'This product was changed by someone else after you started editing it.',
      serverVersion: server.details_version,
    }
  }
  const fresh = await refreshProduct(entry.productId)
  return { kind: 'done', detailsVersion: fresh?.details_version }
}
