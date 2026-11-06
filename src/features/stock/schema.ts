import { z } from 'zod'
import { MOVEMENT_TYPES } from '@/domain/stock'

/** Form shape. Rules that depend on current stock live in domain/stock.ts and the database. */
export const movementFormSchema = z.object({
  type: z.enum(MOVEMENT_TYPES),
  amount: z
    .string()
    .trim()
    .min(1, 'Enter a quantity')
    .transform((v) => Number(v))
    .refine((n) => Number.isFinite(n), 'Enter a number')
    .refine((n) => Math.abs(n) <= 99_999_999, 'Too large'),
  reference: z
    .string()
    .trim()
    .max(64, 'Use at most 64 characters')
    .transform((v) => (v === '' ? null : v)),
  note: z
    .string()
    .trim()
    .max(500, 'Use at most 500 characters')
    .transform((v) => (v === '' ? null : v)),
})

export type MovementFormInput = z.input<typeof movementFormSchema>
export type MovementFormValues = z.output<typeof movementFormSchema>
