import type { StockState } from '@/domain/product-status'

export interface Tag {
  id: string
  name: string
}
export interface Category {
  id: string
  name: string
}

export interface Product {
  id: string
  inventory_id: string
  name: string
  sku: string | null
  barcode: string | null
  qr_code: string | null
  description: string | null
  category_id: string | null
  quantity: number
  unit: string
  min_stock: number
  expires_on: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  stock_state: StockState
  category: { name: string } | null
  product_tags: { tags: Tag | null }[]
  details_version: number
  /** Client-only: number of unsynced queued operations affecting this product. */
  pending_ops?: number
}

export const PAGE_SIZE = 25

export type SortField = 'name' | 'quantity' | 'updated_at' | 'expires_on'

export interface ProductFilters {
  inventoryId: string
  search: string
  categoryId: string
  tagId: string
  state: 'all' | StockState
  expiry: 'all' | 'expired' | 'expiring'
  archived: boolean
  sort: SortField
  ascending: boolean
  page: number
}

export const defaultFilters = (inventoryId: string): ProductFilters => ({
  inventoryId,
  search: '',
  categoryId: '',
  tagId: '',
  state: 'all',
  expiry: 'all',
  archived: false,
  sort: 'name',
  ascending: true,
  page: 0,
})

export interface InventorySummary {
  total_products: number
  total_units: number
  low_stock: number
  out_of_stock: number
  expiring: number
  expired: number
}

export interface CategoryStock {
  category: string
  units: number
  products: number
}

