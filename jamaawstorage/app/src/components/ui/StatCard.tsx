import { cn } from '../../lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  icon?: React.ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
  variant?: 'default' | 'warning' | 'danger'
}

/* O estado critico tinge o numero, nao a borda: sem faixa lateral, sem cartao. */
const valueClasses: Record<NonNullable<StatCardProps['variant']>, string> = {
  default: 'text-ink',
  warning: 'text-warn',
  danger: 'text-blaze',
}

export function StatCard({
  title,
  value,
  icon,
  trend,
  variant = 'default',
}: StatCardProps) {
  return (
    <div className="bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="label-mono truncate">{title}</p>
          <p className={cn('num text-2xl leading-none', valueClasses[variant])}>
            {value}
          </p>
          {trend && (
            <div className="flex items-center gap-1">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={cn(
                  'transition-transform',
                  trend.isPositive ? 'text-ok' : 'rotate-180 text-crit',
                )}
              >
                <path d="M7 2L12 8H2L7 2Z" fill="currentColor" />
              </svg>
              <span
                className={cn(
                  'num text-xs',
                  trend.isPositive ? 'text-ok' : 'text-crit',
                )}
              >
                {Math.abs(trend.value)}%
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0 text-ink-mute">{icon}</div>
        )}
      </div>
    </div>
  )
}
