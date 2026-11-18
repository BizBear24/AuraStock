import { z } from 'zod'
import { roundQty } from './stock'

export const BACKUP_FORMAT = 'aurastock-backup'
export const BACKUP_VERSION = 1

const id = z.string().min(1)
const num = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine(Number.isFinite, 'not a number')

/** The parts of a backup that the validator relies on. Extra fields are allowed and preserved. */
const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number(),
  created_at: z.string(),
  organization: z.object({ id, name: z.string() }).passthrough(),
  inventories: z.array(z.object({ id, name: z.string(), is_demo: z.boolean().optional() }).passthrough()),
  categories: z.array(z.object({ id, inventory_id: id, name: z.string() }).passthrough()),
  tags: z.array(z.object({ id, inventory_id: id, name: z.string() }).passthrough()),
  products: z.array(
    z.object({ id, inventory_id: id, name: z.string(), quantity: num, archived_at: z.string().nullable().optional(), category_id: z.string().nullable().optional() }).passthrough(),
  ),
  product_tags: z.array(z.object({ product_id: id, tag_id: id }).passthrough()),
  stock_movements: z.array(
    z.object({ id, product_id: id, created_at: z.string(), delta: num, quantity_before: num, quantity_after: num }).passthrough(),
  ),
  transfers: z.array(z.object({ id }).passthrough()),
  transfer_lines: z.array(z.object({ id, transfer_id: id }).passthrough()),
})

export type BackupDocument = z.infer<typeof backupSchema>

export interface BackupCounts {
  inventories: number
  products: number
  movements: number
  categories: number
  tags: number
  transfers: number
}

export interface InventorySummary {
  id: string
  name: string
  isDemo: boolean
  products: number
  movements: number
}

export type BackupCheck =
  | { ok: true; document: BackupDocument; counts: BackupCounts; inventories: InventorySummary[] }
  | { ok: false; errors: string[] }

const MAX_ERRORS = 20

/**
 * Full integrity check of a backup before it is trusted or restored: shape and version, every reference
 * resolves, and every product's stock history chains from zero to its recorded quantity. Mirrors the checks
 * restore_backup() performs in the database, so problems are reported before anything is sent.
 */
export function validateBackup(input: unknown): BackupCheck {
  if (typeof input === 'object' && input !== null && 'format' in input && (input as { format: unknown }).format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['This file is not an AuraStock backup.'] }
  }
  if (typeof input === 'object' && input !== null && 'version' in input && (input as { version: unknown }).version !== BACKUP_VERSION) {
    return { ok: false, errors: [`Unsupported backup version ${String((input as { version: unknown }).version)}.`] }
  }
  const parsed = backupSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, MAX_ERRORS).map((i) => `${i.path.join('.') || 'file'}: ${i.message}`) }
  }
  const doc = parsed.data
  const errors: string[] = []
  const add = (e: string) => {
    if (errors.length < MAX_ERRORS) errors.push(e)
  }

  const inventoryIds = new Set(doc.inventories.map((i) => i.id))
  const categoryIds = new Set(doc.categories.map((c) => c.id))
  const tagIds = new Set(doc.tags.map((t) => t.id))
  const products = new Map(doc.products.map((p) => [p.id, p]))

  for (const c of doc.categories) if (!inventoryIds.has(c.inventory_id)) add(`Category "${c.name}" belongs to a missing inventory.`)
  for (const t of doc.tags) if (!inventoryIds.has(t.inventory_id)) add(`Tag "${t.name}" belongs to a missing inventory.`)
  for (const p of doc.products) {
    if (!inventoryIds.has(p.inventory_id)) add(`Product "${p.name}" belongs to a missing inventory.`)
    if (p.category_id && !categoryIds.has(p.category_id)) add(`Product "${p.name}" refers to a missing category.`)
  }
  for (const pt of doc.product_tags) {
    if (!products.has(pt.product_id) || !tagIds.has(pt.tag_id)) add('A product tag link refers to a missing product or tag.')
  }

  // Ledger: group by product, order by time; equal timestamps are ordered by their balance chain.
  const byProduct = new Map<string, BackupDocument['stock_movements']>()
  for (const m of doc.stock_movements) {
    if (!products.has(m.product_id)) {
      add(`Stock movement ${m.id} refers to a missing product.`)
      continue
    }
    byProduct.set(m.product_id, [...(byProduct.get(m.product_id) ?? []), m])
  }
  const movementsPerProduct = new Map<string, number>()
  for (const [productId, list] of byProduct) {
    const items = [...list].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1))
    let balance = 0
    for (let i = 0; i < items.length; i += 1) {
      if (roundQty(items[i]!.quantity_before) !== balance) {
        const t = Date.parse(items[i]!.created_at)
        let j = i + 1
        while (j < items.length && Date.parse(items[j]!.created_at) === t && roundQty(items[j]!.quantity_before) !== balance) j += 1
        if (j >= items.length || Date.parse(items[j]!.created_at) !== t) {
          add(`Stock history of "${products.get(productId)!.name}" does not add up (movement ${items[i]!.id}).`)
          break
        }
        ;[items[i], items[j]] = [items[j]!, items[i]!]
      }
      const m = items[i]!
      if (roundQty(m.quantity_after) !== roundQty(balance + m.delta)) {
        add(`Stock history of "${products.get(productId)!.name}" does not add up (movement ${m.id}).`)
        break
      }
      balance = roundQty(balance + m.delta)
    }
    movementsPerProduct.set(productId, list.length)
  }
  for (const p of doc.products) {
    const history = byProduct.get(p.id) ?? []
    const total = roundQty(history.reduce((s, m) => s + m.delta, 0))
    if (total !== roundQty(p.quantity)) add(`"${p.name}" has quantity ${p.quantity} but its history adds up to ${total}.`)
  }

  if (errors.length > 0) return { ok: false, errors }

  const inventories = doc.inventories.map((inv) => {
    const own = doc.products.filter((p) => p.inventory_id === inv.id)
    return {
      id: inv.id,
      name: inv.name,
      isDemo: Boolean(inv.is_demo),
      products: own.length,
      movements: own.reduce((s, p) => s + (movementsPerProduct.get(p.id) ?? 0), 0),
    }
  })
  return { ok: true, document: doc, counts: countBackup(doc), inventories }
}

export function countBackup(doc: Pick<BackupDocument, 'inventories' | 'products' | 'stock_movements' | 'categories' | 'tags' | 'transfers'>): BackupCounts {
  return {
    inventories: doc.inventories.length,
    products: doc.products.length,
    movements: doc.stock_movements.length,
    categories: doc.categories.length,
    tags: doc.tags.length,
    transfers: doc.transfers.length,
  }
}

/** Lower-case hex SHA-256 of a string's UTF-8 bytes (Web Crypto; available in browsers and Node 18+). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Byte length of a string as UTF-8, i.e. the size of the uploaded file. */
export function utf8Size(text: string): number {
  return new TextEncoder().encode(text).length
}

export function backupFileName(organizationName: string, createdAt: Date, id: string): string {
  const stem = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'organization'
  return `aurastock-${stem}-${createdAt.toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${id.slice(0, 8)}.json`
}

/** Automatic backups older than the newest `keep` are deleted after a successful new one. */
export function backupsToPrune<T extends { id: string; kind: string; created_at: string }>(records: T[], keep = 14): T[] {
  return records
    .filter((r) => r.kind === 'automatic')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(keep)
}
