import { emptyProductForm, productFormSchema } from './schema'

describe('productFormSchema', () => {
  it('requires a name', () => {
    expect(productFormSchema.safeParse({ ...emptyProductForm }).success).toBe(false)
  })

  it('normalises blanks to null and coerces numbers', () => {
    const r = productFormSchema.parse({ ...emptyProductForm, name: ' Rice ', min_stock: '5.5', sku: '  ' })
    expect(r.name).toBe('Rice')
    expect(r.sku).toBeNull()
    expect(r.expires_on).toBeNull()
    expect(r.min_stock).toBe(5.5)
  })

  it('rejects negative thresholds and malformed dates', () => {
    expect(productFormSchema.safeParse({ ...emptyProductForm, name: 'x', min_stock: '-1' }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...emptyProductForm, name: 'x', min_stock: 'abc' }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...emptyProductForm, name: 'x', expires_on: '06/11/2026' }).success).toBe(false)
  })
})
