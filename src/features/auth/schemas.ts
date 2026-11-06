import { z } from 'zod'

const email = z.string().trim().min(1, 'Email is required').email('Enter a valid email address')
const password = z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
})

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your name').max(80),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const organizationSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(80, 'Use at most 80 characters'),
})

export type LoginValues = z.infer<typeof loginSchema>
export type SignUpValues = z.infer<typeof signUpSchema>
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>
