import { cn } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'elevated' | 'bordered' | 'interactive'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
}

const variantClasses: Record<NonNullable<CardProps['variant']>, string> = {
  default: 'bg-gray-900 rounded-xl',
  elevated: 'bg-gray-900 rounded-xl shadow-lg shadow-black/20',
  bordered: 'bg-gray-900 rounded-xl border border-gray-700',
  interactive:
    'bg-gray-900 rounded-xl border border-gray-700 hover:border-orange-500/50 cursor-pointer transition-colors',
}

const paddingClasses: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export function Card({
  children,
  className,
  variant = 'default',
  padding = 'md',
  onClick,
}: CardProps) {
  const Component = onClick ? 'button' : 'div'

  return (
    <Component
      className={cn(variantClasses[variant], paddingClasses[padding], className)}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      {children}
    </Component>
  )
}
