import { cn } from '../../lib/utils'

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  size?: 'sm' | 'md'
  dot?: boolean
  className?: string
}

/*
 * 'primary' e o estado que para a leitura: laranja preenchido.
 * As semanticas ficam em tinta sobre fundo rebaixado.
 */
const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-void text-ink-dim',
  primary: 'bg-blaze text-blaze-ink',
  success: 'bg-ok/15 text-ok',
  warning: 'bg-warn/15 text-warn',
  danger: 'bg-crit/15 text-crit',
  info: 'bg-ink/10 text-ink-dim',
}

const dotColorClasses: Record<BadgeVariant, string> = {
  default: 'bg-ink-mute',
  primary: 'bg-blaze-ink',
  success: 'bg-ok',
  warning: 'bg-warn',
  danger: 'bg-crit',
  info: 'bg-ink-dim',
}

const sizeClasses: Record<NonNullable<BadgeProps['size']>, string> = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
}

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-none font-mono uppercase tracking-wider whitespace-nowrap',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5', dotColorClasses[variant])} />}
      {children}
    </span>
  )
}
