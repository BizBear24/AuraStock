import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { ExpiryBadge, StockBadge } from '@/components/ui/product-badges'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import {
  PAGE_SIZE,
  bulkSetCategory,
  defaultFilters,
  listCategories,
  listProducts,
  listTags,
  setArchived,
  type Product,
  type ProductFilters,
  type SortField,
} from './api'
import { ProductFormDialog } from './ProductFormDialog'

const selectClass = 'h-9 rounded-md border border-line bg-bg-2 px-2 text-sm text-fg'

export function ProductsPage() {
  const { inventory, role } = useWorkspace()
  const queryClient = useQueryClient()
  const canWrite = can(role, 'product.write')
  const [params] = useSearchParams()
  const [filters, setFilters] = useState<Omit<ProductFilters, 'inventoryId'>>(() => {
    const { inventoryId: _unused, ...rest } = defaultFilters('')
    void _unused
    const state = params.get('state')
    const expiry = params.get('expiry')
    return {
      ...rest,
      state: state === 'low' || state === 'out' || state === 'ok' ? state : 'all',
      expiry: expiry === 'expired' || expiry === 'expiring' ? expiry : 'all',
    }
  })
  const [searchText, setSearchText] = useState('')
  const debouncedSearch = useDebouncedValue(searchText)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(false)
  const [categoryDialog, setCategoryDialog] = useState(false)
  const [bulkCategory, setBulkCategory] = useState('')

  const inventoryId = inventory?.id ?? ''
  const active: ProductFilters = useMemo(
    () => ({ ...filters, inventoryId, search: debouncedSearch }),
    [filters, inventoryId, debouncedSearch],
  )

  const products = useQuery({
    queryKey: ['products', active],
    queryFn: () => listProducts(active),
    enabled: Boolean(inventoryId),
    placeholderData: (prev) => prev,
  })
  const categories = useQuery({ queryKey: ['categories', inventoryId], queryFn: () => listCategories(inventoryId), enabled: Boolean(inventoryId) })
  const tags = useQuery({ queryKey: ['tags', inventoryId], queryFn: () => listTags(inventoryId), enabled: Boolean(inventoryId) })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['summary', inventoryId] }),
      queryClient.invalidateQueries({ queryKey: ['category-stock', inventoryId] }),
    ])

  const archive = useMutation({
    mutationFn: (archived: boolean) => setArchived([...selected], archived),
    onSuccess: async () => {
      setSelected(new Set())
      await refresh()
    },
  })
  const recategorise = useMutation({
    mutationFn: () => bulkSetCategory(inventoryId, [...selected], bulkCategory.trim() || null),
    onSuccess: async () => {
      setSelected(new Set())
      setCategoryDialog(false)
      setBulkCategory('')
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['categories', inventoryId] })])
    },
  })

  if (!inventory) {
    return (
      <>
        <PageHeader title="Products" />
        <EmptyState
          title="No inventory selected"
          description="Create an inventory first."
          action={
            <Button asChild variant="primary">
              <Link to="/inventories">Go to inventories</Link>
            </Button>
          }
        />
      </>
    )
  }

  const update = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 0 }))
    setSelected(new Set())
  }
  const rows = products.data?.rows ?? []
  const total = products.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))

  return (
    <>
      <PageHeader
        title="Products"
        description={`${inventory.name} · ${total} ${filters.archived ? 'archived' : 'active'}`}
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New product
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-2" aria-hidden />
          <Input
            aria-label="Search products"
            placeholder="Search name, SKU or barcode"
            className="pl-8"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value)
              update({})
            }}
          />
        </div>
        <select aria-label="Category" className={selectClass} value={filters.categoryId} onChange={(e) => update({ categoryId: e.target.value })}>
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Tag" className={selectClass} value={filters.tagId} onChange={(e) => update({ tagId: e.target.value })}>
          <option value="">All tags</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Availability" className={selectClass} value={filters.state} onChange={(e) => update({ state: e.target.value as ProductFilters['state'] })}>
          <option value="all">Any availability</option>
          <option value="ok">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        <select aria-label="Expiration" className={selectClass} value={filters.expiry} onChange={(e) => update({ expiry: e.target.value as ProductFilters['expiry'] })}>
          <option value="all">Any expiry</option>
          <option value="expiring">Expiring in 30 days</option>
          <option value="expired">Expired</option>
        </select>
        <select
          aria-label="Sort"
          className={selectClass}
          value={`${filters.sort}:${filters.ascending ? 'asc' : 'desc'}`}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(':') as [SortField, string]
            update({ sort, ascending: dir === 'asc' })
          }}
        >
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
          <option value="quantity:asc">Quantity low–high</option>
          <option value="quantity:desc">Quantity high–low</option>
          <option value="expires_on:asc">Expiry soonest</option>
          <option value="updated_at:desc">Recently updated</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={filters.archived} onChange={(e) => update({ archived: e.target.checked })} />
          Archived
        </label>
      </div>

      {canWrite && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
          <span className="num font-medium">{selected.size} selected</span>
          <Button size="sm" loading={archive.isPending} onClick={() => archive.mutate(!filters.archived)}>
            {filters.archived ? 'Restore' : 'Archive'}
          </Button>
          <Button size="sm" onClick={() => setCategoryDialog(true)}>
            Set category
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {archive.isError && <span role="alert" className="text-crit">{errorMessage(archive.error)}</span>}
        </div>
      )}

      <Panel className="overflow-hidden">
        {products.isPending && <LoadingState label="Loading products" />}
        {products.isError && <ErrorState message={errorMessage(products.error)} onRetry={() => void products.refetch()} />}
        {products.data && rows.length === 0 && (
          <div className="p-4">
            <EmptyState
              title={searchText || filters.categoryId || filters.tagId || filters.state !== 'all' || filters.expiry !== 'all' ? 'No matching products' : 'No products yet'}
              description={canWrite ? 'Add a product or adjust the filters.' : 'Adjust the filters.'}
            />
          </div>
        )}
        {rows.length > 0 && (
          <>
            <table className="hidden w-full text-left md:table">
              <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-fg-2">
                <tr>
                  {canWrite && (
                    <th className="w-10 px-3 py-2">
                      <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} />
                    </th>
                  )}
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Quantity</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <ProductRow key={p.id} product={p} selectable={canWrite} selected={selected.has(p.id)} onToggle={toggle} />
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((p) => (
                <li key={p.id} className="flex items-start gap-3 px-3 py-3">
                  {canWrite && <input type="checkbox" aria-label={`Select ${p.name}`} className="mt-1" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />}
                  <Link to={`/products/${p.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-fg-2">{[p.sku, p.category?.name].filter(Boolean).join(' · ') || '—'}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StockBadge state={p.stock_state} />
                      <ExpiryBadge expiresOn={p.expires_on} />
                    </div>
                  </Link>
                  <p className="num text-right font-semibold">
                    {p.quantity} <span className="text-xs font-normal text-fg-2">{p.unit}</span>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="num text-fg-2">
            Page {filters.page + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={filters.page === 0} onClick={() => update({ page: filters.page - 1 })}>
              Previous
            </Button>
            <Button size="sm" disabled={filters.page + 1 >= pageCount} onClick={() => update({ page: filters.page + 1 })}>
              Next
            </Button>
          </div>
        </div>
      )}

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} inventoryId={inventory.id} product={null} />

      <Dialog open={categoryDialog} onOpenChange={setCategoryDialog} title="Set category" description={`Applies to ${selected.size} selected products. Leave blank to clear.`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            recategorise.mutate()
          }}
        >
          {recategorise.isError && <p role="alert" className="text-sm text-crit">{errorMessage(recategorise.error)}</p>}
          <Field label="Category" list="bulk-category-options" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} />
          <datalist id="bulk-category-options">
            {categories.data?.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setCategoryDialog(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={recategorise.isPending}>
              Apply
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}

function ProductRow({ product: p, selectable, selected, onToggle }: { product: Product; selectable: boolean; selected: boolean; onToggle: (id: string) => void }) {
  return (
    <tr className="hover:bg-surface">
      {selectable && (
        <td className="px-3 py-2">
          <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected} onChange={() => onToggle(p.id)} />
        </td>
      )}
      <td className="px-3 py-2">
        <Link to={`/products/${p.id}`} className="font-medium hover:underline">
          {p.name}
        </Link>
        {p.barcode && <p className="num text-xs text-fg-2">{p.barcode}</p>}
      </td>
      <td className="num px-3 py-2 text-fg-2">{p.sku ?? '—'}</td>
      <td className="px-3 py-2 text-fg-2">{p.category?.name ?? '—'}</td>
      <td className="num px-3 py-2 text-right font-semibold">
        {p.quantity} <span className="text-xs font-normal text-fg-2">{p.unit}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <StockBadge state={p.stock_state} />
          <ExpiryBadge expiresOn={p.expires_on} />
        </div>
      </td>
    </tr>
  )
}
