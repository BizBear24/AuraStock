import { forgotPasswordSchema, loginSchema, organizationSchema, signUpSchema } from './schemas'

describe('auth schemas', () => {
  it('rejects malformed email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false)
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.co' }).success).toBe(true)
  })

  it('requires matching, long-enough passwords on sign up', () => {
    const base = { fullName: 'Ada Lovelace', email: 'ada@example.com' }
    expect(signUpSchema.safeParse({ ...base, password: 'short', confirmPassword: 'short' }).success).toBe(false)
    const mismatch = signUpSchema.safeParse({ ...base, password: 'longenough1', confirmPassword: 'different1' })
    expect(mismatch.success).toBe(false)
    expect(signUpSchema.safeParse({ ...base, password: 'longenough1', confirmPassword: 'longenough1' }).success).toBe(true)
  })

  it('trims and bounds organization names', () => {
    expect(organizationSchema.safeParse({ name: ' a ' }).success).toBe(false)
    expect(organizationSchema.parse({ name: '  Acme Foods ' }).name).toBe('Acme Foods')
  })
})
