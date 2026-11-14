import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { errorMessage } from '@/lib/supabase'
import { useOffline } from '@/offline/OfflineProvider'
import { QueuedNotice } from '@/offline/QueuedNotice'
import { listCategories, listTags, type Product } from './api'
import { emptyProductForm, productFormSchema, type ProductFormInput, type ProductFormValues } from './schema'

function toFormValues(p: Product | null, initial?: Partial<ProductFormInput>): ProductFormInput {
  if (!p) return { ...emptyProductForm, ...initial }
  return {
    name: p.name,
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    qr_code: p.qr_code ?? '',
    description: p.description ?? '',
    category: p.category?.name ?? '',
    tags: p.product_tags.flatMap((t) => (t.tags ? [t.tags.name] : [])).join(', '),
    unit: p.unit,
    min_stock: String(p.min_stock),
    expires_on: p.expires_on ?? '',
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventoryId: string
  product: Product | null
  /** Prefill for a new product, e.g. a scanned barcode. */
  initial?: Partial<ProductFormInput>
  onSaved?: (id: string) => void
}

export function ProductFormDialog({ open, onOpenChange, inventoryId, product, initial, onSaved }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={product ? 'Edit product' : 'New product'}
      description={product ? undefined : 'New products start at zero stock. Record a stock movement to add quantity.'}
    >
      {/* Dialog content unmounts when closed, so form state and idempotency keys are fresh on every open. */}
      <ProductForm inventoryId={inventoryId} product={product} initial={initial} onClose={() => onOpenChange(false)} onSaved={onSaved} />
    </Dialog>
  )
}

function ProductForm({ inventoryId, product, initial, onClose, onSaved }: { inventoryId: string; product: Product | null; initial?: Partial<ProductFormInput>; onClose: () => void; onSaved?: (id: string) => void }) {
  const queryClient = useQueryClient()
  const { client } = useOffline()
  const [operationId] = useState(() => crypto.randomUUID())
  const [newProductId] = useState(() => crypto.randomUUID())
  const categories = useQuery({ queryKey: ['categories', inventoryId], queryFn: () => listCategories(inventoryId) })
  const tags = useQuery({ queryKey: ['tags', inventoryId], queryFn: () => listTags(inventoryId) })

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormInput, unknown, ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: toFormValues(product, initial),
  })

  const save = useMutation({
    mutationFn: (values: ProductFormValues) => client.submitProduct({ inventoryId, product, newProductId, values, operationId }),
    onSettled: () =>
      Promise.all(
        ['products', 'product', 'categories', 'tags', 'summary', 'category-stock', 'notifications'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
    onSuccess: ({ result, productId }) => {
      if (result.status === 'synced') {
        onClose()
        onSaved?.(productId)
      }
    },
  })

  if (save.data?.result.status === 'queued') {
    const productId = save.data.productId
    return (
      <QueuedNotice
        onDone={() => {
          onClose()
          onSaved?.(productId)
        }}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
      {save.isError && (
        <p role="alert" className="rounded-md border border-crit px-3 py-2 text-sm text-crit">
          {errorMessage(save.error)}
        </p>
      )}
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU" error={errors.sku?.message} {...register('sku')} />
        <Field label="Barcode" inputMode="numeric" error={errors.barcode?.message} {...register('barcode')} />
      </div>
      <Field label="QR code value" error={errors.qr_code?.message} {...register('qr_code')} />
      <Field label="Description" error={errors.description?.message} {...register('description')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" list="category-options" error={errors.category?.message} {...register('category')} />
        <Field label="Unit" error={errors.unit?.message} {...register('unit')} />
      </div>
      <datalist id="category-options">
        {categories.data?.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <Field
        label="Tags"
        hint={tags.data?.length ? `Comma separated. Existing: ${tags.data.map((t) => t.name).join(', ')}` : 'Comma separated'}
        error={errors.tags?.message}
        {...register('tags')}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum stock" inputMode="decimal" error={errors.min_stock?.message} {...register('min_stock')} />
        <Field label="Expiration date" type="date" error={errors.expires_on?.message} {...register('expires_on')} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {product ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  )
}
