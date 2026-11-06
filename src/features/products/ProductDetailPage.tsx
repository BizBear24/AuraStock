import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Archive, ArchiveRestore, Copy, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { PageHeader, Panel } from '@/components/ui/panel'
import { ExpiryBadge, StockBadge } from '@/components/ui/product-badges'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { can } from '@/domain/permissions'
import { errorMessage } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { useWorkspace } from '@/features/organizations/WorkspaceProvider'
import { deleteProduct, duplicateProduct, getProduct, setArchived } from './api'
import { ProductFormDialog } from './ProductFormDialog'

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const { role } = useWorkspace()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const query = useQuery({ queryKey: ['product', id], queryFn: () => getProduct(id), enabled: Boolean(id) })
  const afterChange = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['product', id] }),
      queryClient.invalidateQueries({ queryKey: ['summary'] }),
      queryClient.invalidateQueries({ queryKey: ['category-stock'] }),
    ])
  }

  const archive = useMutation({
    mutationFn: (archived: boolean) => setArchived([id], archived),
    onSuccess: afterChange,
  })
  const duplicate = useMutation({
    mutationFn: () => duplicateProduct(query.data!, user!.id),
    onSuccess: async (newId) => {
      await afterChange()
      navigate(`/products/${newId}`)
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteProduct(id),
    onSuccess: async () => {
      await afterChange()
      navigate('/products', { replace: true })
    },
  })

  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />

  const p = query.data
  const canWrite = can(role, 'product.write')
  const canDelete = can(role, 'inventory.manage')
  const tags = p.product_tags.flatMap((t) => (t.tags ? [t.tags.name] : []))
  const actionError = archive.error ?? duplicate.error

  return (
    <>
      <Link to="/products" className="mb-2 inline-flex items-center gap-1 text-sm text-fg-2 hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Products
      </Link>
      <PageHeader
        title={p.name}
        description={[p.sku && `SKU ${p.sku}`, p.category?.name].filter(Boolean).join(' · ') || undefined}
        actions={
          canWrite && (
            <>
              <Button onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </Button>
              <Button loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
                <Copy className="h-4 w-4" aria-hidden /> Duplicate
              </Button>
              <Button loading={archive.isPending} onClick={() => archive.mutate(!p.archived_at)}>
                {p.archived_at ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
                {p.archived_at ? 'Restore' : 'Archive'}
              </Button>
              {canDelete && p.archived_at && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden /> Delete
                </Button>
              )}
            </>
          )
        }
      />
      {actionError && (
        <p role="alert" className="mb-3 text-sm text-crit">
          {errorMessage(actionError)}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Panel className="h-fit p-4">
          <p className="text-xs uppercase tracking-wide text-fg-2">On hand</p>
          <p className="num text-3xl font-semibold">
            {p.quantity} <span className="text-base font-normal text-fg-2">{p.unit}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {p.archived_at && <StatusBadge status="neutral">Archived</StatusBadge>}
            <StockBadge state={p.stock_state} />
            <ExpiryBadge expiresOn={p.expires_on} />
          </div>
          <p className="mt-3 text-xs text-fg-2">Stock changes are recorded as movements (coming in the next phase).</p>
        </Panel>

        <Panel className="p-4">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-fg-2">Barcode</dt>
            <dd className="num break-all">{p.barcode ?? '—'}</dd>
            <dt className="text-fg-2">QR code</dt>
            <dd className="break-all">{p.qr_code ?? '—'}</dd>
            <dt className="text-fg-2">Minimum stock</dt>
            <dd className="num">{p.min_stock} {p.unit}</dd>
            <dt className="text-fg-2">Expires</dt>
            <dd className="num">{p.expires_on ?? '—'}</dd>
            <dt className="text-fg-2">Tags</dt>
            <dd>{tags.length ? tags.join(', ') : '—'}</dd>
            <dt className="text-fg-2">Description</dt>
            <dd className="whitespace-pre-wrap">{p.description ?? '—'}</dd>
            <dt className="text-fg-2">Created</dt>
            <dd className="num">{new Date(p.created_at).toLocaleString()}</dd>
            <dt className="text-fg-2">Updated</dt>
            <dd className="num">{new Date(p.updated_at).toLocaleString()}</dd>
          </dl>
        </Panel>
      </div>

      <ProductFormDialog open={editing} onOpenChange={setEditing} inventoryId={p.inventory_id} product={p} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete product permanently?"
        description={`"${p.name}" will be removed and cannot be recovered.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
