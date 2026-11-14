import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { evaluateMovement, formatQty, MOVEMENT_LABEL, MOVEMENT_TYPES, type MovementType } from '@/domain/stock'
import { errorMessage } from '@/lib/supabase'
import type { Product } from '@/features/products/api'
import { useOffline } from '@/offline/OfflineProvider'
import { QueuedNotice } from '@/offline/QueuedNotice'
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
  /** Prefilled quantity, e.g. 1 from a scan. */
  initialAmount?: string
}

export function StockMovementDialog({ open, onOpenChange, product, initialType = 'in', initialAmount = '' }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Record movement · ${product.name}`}
      description={`On hand: ${formatQty(product.quantity)} ${product.unit}${product.pending_ops ? ` (includes ${product.pending_ops} unsynced)` : ''}`}
    >
      {/* Dialog content unmounts when closed, so the form, mutation and idempotency key are fresh on every open. */}
      <MovementForm product={product} initialType={initialType} initialAmount={initialAmount} onClose={() => onOpenChange(false)} />
    </Dialog>
  )
}

function MovementForm({ product, initialType, initialAmount, onClose }: { product: Product; initialType: MovementType; initialAmount: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { client } = useOffline()
  // One idempotency key per user intent: a retry after a dropped connection cannot double-apply.
  const [operationId] = useState(() => crypto.randomUUID())

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<MovementFormInput, unknown, MovementFormValues>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: { type: initialType, amount: initialAmount, reference: '', note: '' },
  })

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
      client.submitMovement({ product, type: v.type, amount: v.amount, reference: v.reference, note: v.note, operationId }),
    onSettled: () =>
      Promise.all(
        ['product', 'products', 'movements', 'summary', 'category-stock', 'movement-summary', 'notifications'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
    onSuccess: (result) => {
      if (result.status === 'synced') onClose()
    },
  })

  if (record.data?.status === 'queued') return <QueuedNotice onDone={onClose} />

  return (
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
      <Field label={type === 'adjustment' || type === 'correction' ? 'Note (required)' : 'Note (optional)'} error={errors.note?.message} {...register('note')} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={record.isPending} disabled={check?.ok === false}>
          Record movement
        </Button>
      </div>
    </form>
  )
}
