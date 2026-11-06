import { z } from 'zod'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))

const nonNegative = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((v) => Number(v))
    .refine((n) => Number.isFinite(n), `${label} must be a number`)
    .refine((n) => n >= 0, `${label} cannot be negative`)
    .refine((n) => n <= 99_999_999, 'Too large')

/** Form input shape (all strings) → validated product payload. Quantity is intentionally absent: stock changes only via movements. */
export const productFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Use at most 200 characters'),
  sku: optionalText(80),
  barcode: optionalText(128),
  qr_code: optionalText(512),
  description: optionalText(2000),
  category: optionalText(60),
  tags: z.string().max(500, 'Too many tags'),
  unit: z.string().trim().min(1, 'Unit is required').max(20),
  min_stock: nonNegative('Minimum stock'),
  expires_on: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date')
    .transform((v) => (v === '' ? null : v)),
})

export type ProductFormInput = z.input<typeof productFormSchema>
export type ProductFormValues = z.output<typeof productFormSchema>

export const emptyProductForm: ProductFormInput = {
  name: '',
  sku: '',
  barcode: '',
  qr_code: '',
  description: '',
  category: '',
  tags: '',
  unit: 'pcs',
  min_stock: '0',
  expires_on: '',
}
