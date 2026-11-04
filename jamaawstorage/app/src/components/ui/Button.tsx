import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '../../lib/utils'
import { Spinner } from './Spinner'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

/* O acento so existe preenchido. As demais variantes vivem de divisor e texto. */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-blaze text-blaze-ink hover:bg-blaze/90',
  secondary: 'bg-surface text-ink border border-line hover:border-ink-mute',
  danger: 'bg-surface text-crit border border-crit/40 hover:border-crit',
  ghost: 'text-ink-dim hover:bg-surface hover:text-ink',
  outline: 'border border-line text-ink hover:border-ink-mute',
}

/* min-h-touch garante 44px de alvo mesmo no tamanho sm. */
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-touch px-3 text-sm',
  md: 'min-h-touch px-4 text-sm',
  lg: 'min-h-touch px-6 py-3 text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      className,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-none font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ink/40 focus:ring-offset-2 focus:ring-offset-void',
          variantClasses[variant],
          sizeClasses[size],
          isDisabled && 'pointer-events-none opacity-50',
          className,
        )}
        disabled={isDisabled}
        {...props}
      >
        {isLoading ? (
          <Spinner size="sm" className="text-current" />
        ) : (
          leftIcon && <span className="flex-shrink-0">{leftIcon}</span>
        )}
        {children}
        {rightIcon && !isLoading && (
          <span className="flex-shrink-0">{rightIcon}</span>
        )}
      </button>
    )
  },
)

Button.displayName = 'Button'
