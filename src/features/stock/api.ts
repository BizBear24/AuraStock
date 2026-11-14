import type { MovementType } from '@/domain/stock'
import { supabase } from '@/lib/supabase'

export interface Movement {
  id: string
  product_id: string
  movement_type: MovementType
  delta: number
  quantity_before: number
  quantity_after: number
  reference: string | null
  note: string | null
  created_at: string
  product: { name: string; unit: string; sku: string | null } | null
  author: { full_name: string | null; email: string } | null
}

export const MOVEMENTS_PAGE_SIZE = 25

export interface MovementFilters {
  inventoryId: string
  productId?: string
  type: 'all' | MovementType
  page: number
  pageSize?: number
}

export async function listMovements(f: MovementFilters): Promise<{ rows: Movement[]; total: number }> {
  const size = f.pageSize ?? MOVEMENTS_PAGE_SIZE
  let q = supabase
    .from('stock_movements')
    .select(
      'id, product_id, movement_type, delta, quantity_before, quantity_after, reference, note, created_at, product:products(name, unit, sku), author:profiles!created_by(full_name, email)',
      { count: 'exact' },
    )
    .eq('inventory_id', f.inventoryId)
  if (f.productId) q = q.eq('product_id', f.productId)
  if (f.type !== 'all') q = q.eq('movement_type', f.type)
  const from = f.page * size
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, from + size - 1)
    .returns<Movement[]>()
  if (error) throw error
  return { rows: data, total: count ?? 0 }
}

export interface RecordMovementInput {
  productId: string
  type: MovementType
  amount: number
  /** Idempotency key. Reuse the same value when retrying the same user action. */
  operationId: string
  reference: string | null
  note: string | null
}

export async function recordMovement(input: RecordMovementInput): Promise<void> {
  const { error } = await supabase.rpc('record_stock_movement', {
    p_product_id: input.productId,
    p_type: input.type,
    p_amount: input.amount,
    p_operation_id: input.operationId,
    p_reference: input.reference,
    p_note: input.note,
  })
  if (error) throw error
}

export interface MovementDay {
  day: string
  units_in: number
  units_out: number
}

export async function fetchMovementSummary(inventoryId: string, days = 14): Promise<MovementDay[]> {
  const { data, error } = await supabase.rpc('movement_summary', { inv: inventoryId, days })
  if (error) throw error
  return (data ?? []) as MovementDay[]
}

/** One page of movements inside an optional time range, oldest first, for exports. */
export async function fetchMovementsPage(
  inventoryId: string,
  fromIso: string | null,
  toIso: string | null,
  offset: number,
  limit: number,
): Promise<Movement[]> {
  let q = supabase
    .from('stock_movements')
    .select(
      'id, product_id, movement_type, delta, quantity_before, quantity_after, reference, note, created_at, product:products(name, unit, sku), author:profiles!created_by(full_name, email)',
    )
    .eq('inventory_id', inventoryId)
  if (fromIso) q = q.gte('created_at', fromIso)
  if (toIso) q = q.lt('created_at', toIso)
  const { data, error } = await q
    .order('created_at', { ascending: true })
    .order('id')
    .range(offset, offset + limit - 1)
    .returns<Movement[]>()
  if (error) throw error
  return data
}
