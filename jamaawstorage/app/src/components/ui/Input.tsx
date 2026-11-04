import { type InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  leftIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'text-sm font-medium',
              error ? 'text-crit' : 'text-ink-dim',
            )}
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'min-h-touch w-full rounded-none border bg-void px-3 py-2 text-sm text-ink placeholder-ink-mute transition-colors focus:outline-none',
              error
                ? 'border-crit focus:border-crit'
                : 'border-line focus:border-ink',
              leftIcon ? 'pl-10' : '',
              props.disabled ? 'cursor-not-allowed opacity-50' : '',
              className,
            )}
            {...props}
          />
        </div>
        {error && <p className="text-sm text-crit">{error}</p>}
        {helperText && !error && (
          <p className="text-sm text-ink-mute">{helperText}</p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'
