import { type SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'

interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className={cn(
              'text-sm font-medium',
              error ? 'text-crit' : 'text-ink-dim',
            )}
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'min-h-touch w-full appearance-none rounded-none border bg-void px-3 py-2 text-sm text-ink transition-colors focus:outline-none',
            error ? 'border-crit focus:border-crit' : 'border-line focus:border-ink',
            props.disabled && 'cursor-not-allowed opacity-50',
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-crit">{error}</p>}
      </div>
    )
  },
)

Select.displayName = 'Select'
