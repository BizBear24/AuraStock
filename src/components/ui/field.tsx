import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-line bg-bg-2 px-3 text-sm text-fg placeholder:text-fg-2 disabled:opacity-50 aria-[invalid=true]:border-crit',
        className,
      )}
      {...props}
    />
  )
})

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: ReactNode
}

/** Labelled input with accessible error wiring. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id, ...props },
  ref,
) {
  const generated = useId()
  const inputId = id ?? generated
  const messageId = `${inputId}-msg`
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-[13px] font-medium">
        {label}
      </label>
      <Input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        {...props}
      />
      {(error || hint) && (
        <p id={messageId} role={error ? 'alert' : undefined} className={cn('text-xs', error ? 'text-crit' : 'text-fg-2')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
})
