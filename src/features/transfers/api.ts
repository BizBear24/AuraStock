import { findLineByCode, type TransferStatus } from '@/domain/transfer'
import { supabase } from '@/lib/supabase'

export interface TransferLine {
  id: string
  source_product_id: string
  destination_product_id: string | null
  product_name: string
  sku: string | null
  barcode: string | null
  qr_code: string | null
  unit: string
  quantity_sent: number
  quantity_received: number
}

export interface Transfer {
  id: string
  reference: string
  status: TransferStatus
  note: string | null
  closed_note: string | null
  dispatched_at: string
  completed_at: string | null
  cancelled_at: string | null
  source_inventory_id: string
  destination_inventory_id: string
  source: { id: string; name: string } | null
  destination: { id: string; name: string } | null
  lines: TransferLine[]
}

const COLUMNS =
  'id, reference, status, note, closed_note, dispatched_at, completed_at, cancelled_at, source_inventory_id, destination_inventory_id, ' +
  'source:inventories!source_inventory_id(id, name), destination:inventories!destination_inventory_id(id, name), ' +
  'lines:transfer_lines(id, source_product_id, destination_product_id, product_name, sku, barcode, qr_code, unit, quantity_sent, quantity_received)'

export const TRANSFERS_PAGE_SIZE = 20

export type Direction = 'incoming' | 'outgoing' | 'all'

export async function listTransfers(input: {
  organizationId: string
  inventoryId: string
  direction: Direction
  status: 'all' | TransferStatus
  page: number
}): Promise<{ rows: Transfer[]; total: number }> {
  let q = supabase.from('transfers').select(COLUMNS, { count: 'exact' }).eq('organization_id', input.organizationId)
  if (input.direction === 'incoming') q = q.eq('destination_inventory_id', input.inventoryId)
  else if (input.direction === 'outgoing') q = q.eq('source_inventory_id', input.inventoryId)
  else q = q.or(`source_inventory_id.eq.${input.inventoryId},destination_inventory_id.eq.${input.inventoryId}`)
  if (input.status !== 'all') q = q.eq('status', input.status)
  const from = input.page * TRANSFERS_PAGE_SIZE
  const { data, error, count } = await q
    .order('dispatched_at', { ascending: false })
    .order('id')
    .range(from, from + TRANSFERS_PAGE_SIZE - 1)
    .returns<Transfer[]>()
  if (error) throw error
  return { rows: data, total: count ?? 0 }
}

export async function getTransfer(id: string): Promise<Transfer> {
  const { data, error } = await supabase.from('transfers').select(COLUMNS).eq('id', id).single<Transfer>()
  if (error) throw error
  return data
}

/** How many transfers are on their way to an inventory. */
export async function countIncoming(inventoryId: string): Promise<number> {
  const { count, error } = await supabase
    .from('transfers')
    .select('id', { count: 'exact', head: true })
    .eq('destination_inventory_id', inventoryId)
    .eq('status', 'in_transit')
  if (error) throw error
  return count ?? 0
}

export interface IncomingMatch {
  transfer: Transfer
  line: TransferLine
}

/** The in-transit transfer line (to this inventory) that a scanned code belongs to, if any. */
export async function findIncomingLine(inventoryId: string, code: string): Promise<IncomingMatch | null> {
  const { data, error } = await supabase
    .from('transfers')
    .select(COLUMNS)
    .eq('destination_inventory_id', inventoryId)
    .eq('status', 'in_transit')
    .order('dispatched_at', { ascending: true })
    .limit(100)
    .returns<Transfer[]>()
  if (error) throw error
  for (const transfer of data) {
    const line = findLineByCode(transfer.lines, code)
    if (line && line.quantity_received < line.quantity_sent) return { transfer, line }
  }
  return null
}

export async function dispatchTransfer(input: {
  sourceId: string
  destinationId: string
  lines: { product_id: string; quantity: number }[]
  note: string | null
  operationId: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('dispatch_transfer', {
    p_source: input.sourceId,
    p_destination: input.destinationId,
    p_lines: input.lines,
    p_note: input.note,
    p_operation_id: input.operationId,
  })
  if (error) throw error
  return data as string
}

export interface ReceiveResult {
  status: 'in_transit' | 'completed'
  outstanding: number
}

export async function receiveTransfer(input: {
  transferId: string
  lines: { line_id: string; quantity: number }[]
  operationId: string
}): Promise<ReceiveResult> {
  const { data, error } = await supabase.rpc('receive_transfer', {
    p_transfer: input.transferId,
    p_lines: input.lines,
    p_operation_id: input.operationId,
  })
  if (error) throw error
  return data as ReceiveResult
}

export async function closeTransfer(transferId: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('close_transfer', { p_transfer: transferId, p_note: note })
  if (error) throw error
}

export async function cancelTransfer(transferId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_transfer', { p_transfer: transferId })
  if (error) throw error
}
