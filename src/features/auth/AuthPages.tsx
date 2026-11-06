import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { errorMessage } from '@/lib/supabase'
import { useAuth } from './AuthProvider'
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
  type ForgotPasswordValues,
  type LoginValues,
  type ResetPasswordValues,
  type SignUpValues,
} from './schemas'

function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-2">AuraStock</p>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="rounded-lg border border-line bg-bg-2 p-5">{children}</div>
        {footer && <p className="mt-4 text-center text-sm text-fg-2">{footer}</p>}
      </div>
    </main>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md border border-crit px-3 py-2 text-sm text-crit">
      {message}
    </p>
  )
}

export function LoginPage() {
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  if (user) return <Navigate to={from} replace />

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      await signIn(values.email, values.password)
      navigate(from, { replace: true })
    } catch (e) {
      setError(errorMessage(e, 'Unable to sign in.'))
    }
  })

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          No account? <Link className="text-fg underline" to="/signup">Create one</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormError message={error} />
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
        <Link to="/forgot-password" className="block text-center text-sm text-fg-2 underline">
          Forgot password?
        </Link>
      </form>
    </AuthLayout>
  )
}

export function SignUpPage() {
  const { signUp, user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) })

  if (user) return <Navigate to="/" replace />

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      const { needsConfirmation } = await signUp(values.email, values.password, values.fullName)
      setConfirmationSent(needsConfirmation)
    } catch (e) {
      setError(errorMessage(e, 'Unable to create the account.'))
    }
  })

  if (confirmationSent) {
    return (
      <AuthLayout title="Check your email" footer={<Link className="text-fg underline" to="/login">Back to sign in</Link>}>
        <p className="text-sm">We sent a confirmation link. Open it to activate your account, then sign in.</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create account"
      footer={
        <>
          Already registered? <Link className="text-fg underline" to="/login">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormError message={error} />
        <Field label="Full name" autoComplete="name" error={errors.fullName?.message} {...register('fullName')} />
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field label="Password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
        <Field label="Confirm password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      await requestPasswordReset(values.email)
      setSent(true)
    } catch (e) {
      setError(errorMessage(e, 'Unable to send the reset email.'))
    }
  })

  return (
    <AuthLayout title="Reset password" footer={<Link className="text-fg underline" to="/login">Back to sign in</Link>}>
      {sent ? (
        <p className="text-sm">If an account exists for that address, a reset link is on its way.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <FormError message={error} />
          <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

/** Reached from the emailed recovery link; Supabase establishes a recovery session first. */
export function ResetPasswordPage() {
  const { updatePassword, user, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) })

  if (!loading && !user) return <Navigate to="/forgot-password" replace />

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      await updatePassword(values.password)
      navigate('/', { replace: true })
    } catch (e) {
      setError(errorMessage(e, 'Unable to update the password.'))
    }
  })

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormError message={error} />
        <Field label="New password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
        <Field label="Confirm password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
