import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { errorMessage } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { listCategories, listTags, saveProduct, type Product } from './api'
import { emptyProductForm, productFormSchema, type ProductFormInput, type ProductFormValues } from './schema'

function toFormValues(p: Product | null): ProductFormInput {
  if (!p) return emptyProductForm
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
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const categories = useQuery({ queryKey: ['categories', inventoryId], queryFn: () => listCategories(inventoryId), enabled: open })
  const tags = useQuery({ queryKey: ['tags', inventoryId], queryFn: () => listTags(inventoryId), enabled: open })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProductFormInput, unknown, ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: toFormValues(product),
  })

  useEffect(() => {
    if (open) reset({ ...toFormValues(product), ...(product ? {} : initial) })
  }, [open, product, initial, reset])

  const save = useMutation({
    mutationFn: (values: ProductFormValues) => saveProduct({ inventoryId, userId: user!.id, id: product?.id, values }),
    onSuccess: async (id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['product', id] }),
        queryClient.invalidateQueries({ queryKey: ['categories', inventoryId] }),
        queryClient.invalidateQueries({ queryKey: ['tags', inventoryId] }),
        queryClient.invalidateQueries({ queryKey: ['summary', inventoryId] }),
      ])
      onOpenChange(false)
      onSaved?.(id)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={product ? 'Edit product' : 'New product'}
      description={product ? undefined : 'New products start at zero stock. Record a stock movement to add quantity.'}
    >
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
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {product ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
