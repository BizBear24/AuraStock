import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { evaluateMovement, formatQty, MOVEMENT_LABEL, MOVEMENT_TYPES, type MovementType } from '@/domain/stock'
import { errorMessage } from '@/lib/supabase'
import type { Product } from '@/features/products/api'
import { recordMovement } from './api'
import { movementFormSchema, type MovementFormInput, type MovementFormValues } from './schema'

const AMOUNT_LABEL: Record<MovementType, string> = {
  in: 'Quantity to add',
  out: 'Quantity to remove',
  adjustment: 'Counted quantity on hand',
  correction: 'Change (use − to reduce)',
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Product
  initialType?: MovementType
  /** Prefilled values, e.g. from a scan. */
  initialAmount?: string
}

export function StockMovementDialog({ open, onOpenChange, product, initialType = 'in', initialAmount = '' }: Props) {
  const queryClient = useQueryClient()
  // One idempotency key per user intent: retries after a network failure cannot double-apply.
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MovementFormInput, unknown, MovementFormValues>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: { type: initialType, amount: initialAmount, reference: '', note: '' },
  })

  useEffect(() => {
    if (open) reset({ type: initialType, amount: initialAmount, reference: '', note: '' })
  }, [open, initialType, initialAmount, reset])

  // New key each time the dialog is opened (render-phase adjustment, no effect needed).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOperationId(crypto.randomUUID())
  }

  const watched = useWatch({ control })
  const type = watched.type ?? initialType
  const amountText = watched.amount ?? ''
  const check =
    amountText.trim() === ''
      ? null
      : evaluateMovement(type, Number(amountText), {
          current: product.quantity,
          archived: Boolean(product.archived_at),
          expiresOn: product.expires_on,
          note: watched.note,
        })

  const record = useMutation({
    mutationFn: (v: MovementFormValues) =>
      recordMovement({ productId: product.id, type: v.type, amount: v.amount, operationId, reference: v.reference, note: v.note }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product', product.id] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['movements'] }),
        queryClient.invalidateQueries({ queryKey: ['summary'] }),
        queryClient.invalidateQueries({ queryKey: ['category-stock'] }),
        queryClient.invalidateQueries({ queryKey: ['movement-summary'] }),
      ]),
    onSuccess: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Record movement · ${product.name}`} description={`On hand: ${formatQty(product.quantity)} ${product.unit}`}>
      <form onSubmit={handleSubmit((v) => record.mutate(v))} className="space-y-3" noValidate>
        {record.isError && (
          <p role="alert" className="rounded-md border border-crit px-3 py-2 text-sm text-crit">
            {errorMessage(record.error)}
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="movement-type" className="block text-[13px] font-medium">
            Type
          </label>
          <select id="movement-type" className="h-9 w-full rounded-md border border-line bg-bg-2 px-2 text-sm" {...register('type')}>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {MOVEMENT_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <Field label={AMOUNT_LABEL[type]} inputMode="decimal" autoFocus error={errors.amount?.message} {...register('amount')} />
        {check && (
          <p className={`num text-sm ${check.ok ? 'text-fg-2' : 'text-crit'}`} role={check.ok ? undefined : 'alert'}>
            {check.ok ? `New quantity: ${formatQty(check.after)} ${product.unit} (${check.delta > 0 ? '+' : ''}${formatQty(check.delta)})` : check.reason}
          </p>
        )}
        <Field label="Reference number (optional)" error={errors.reference?.message} {...register('reference')} />
        <Field
          label={type === 'adjustment' || type === 'correction' ? 'Note (required)' : 'Note (optional)'}
          error={errors.note?.message}
          {...register('note')}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={record.isPending} disabled={check?.ok === false}>
            Record movement
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
