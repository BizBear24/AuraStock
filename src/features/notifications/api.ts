import { supabase } from '@/lib/supabase'

export type AlertKind = 'low_stock' | 'out_of_stock' | 'expiring' | 'expired' | 'transfer_incoming' | 'transfer_discrepancy'

export interface AppNotification {
  id: string
  inventory_id: string
  product_id: string | null
  kind: AlertKind
  title: string
  body: string
  created_at: string
  is_read: boolean
}

export const NOTIFICATIONS_PAGE_SIZE = 25

interface NotificationRow extends AppNotification {
  total_count: number
}

export async function listNotifications(input: {
  organizationId: string
  inventoryId?: string
  unreadOnly: boolean
  page: number
  pageSize?: number
}): Promise<{ rows: AppNotification[]; total: number }> {
  const size = input.pageSize ?? NOTIFICATIONS_PAGE_SIZE
  const { data, error } = await supabase.rpc('list_notifications', {
    p_org: input.organizationId,
    p_inventory: input.inventoryId ?? null,
    p_unread_only: input.unreadOnly,
    p_limit: size,
    p_offset: input.page * size,
  })
  if (error) throw error
  const rows = (data ?? []) as NotificationRow[]
  return { rows, total: Number(rows[0]?.total_count ?? 0) }
}

export async function unreadCount(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('unread_notification_count', { p_org: organizationId })
  if (error) throw error
  return Number(data ?? 0)
}

export async function markRead(organizationId: string, ids: string[] | null): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read', { p_org: organizationId, p_ids: ids })
  if (error) throw error
}
