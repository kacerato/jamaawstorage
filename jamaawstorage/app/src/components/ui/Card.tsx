import { cn } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'elevated' | 'bordered' | 'interactive'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
}

/*
 * Um unico nivel de elevacao: surface. Um Card nunca contem outro Card;
 * dentro dele a separacao e feita por divisor (border-line), nunca por
 * um segundo fundo. 'elevated' existe so por compatibilidade de API.
 */
const variantClasses: Record<NonNullable<CardProps['variant']>, string> = {
  default: 'bg-surface rounded-none',
  elevated: 'bg-surface rounded-none',
  bordered: 'bg-surface rounded-none border border-line',
  interactive:
    'bg-surface rounded-none border border-line hover:border-ink-mute cursor-pointer transition-colors text-left w-full',
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
