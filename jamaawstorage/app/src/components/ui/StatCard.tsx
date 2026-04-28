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

const variantClasses: Record<NonNullable<StatCardProps['variant']>, string> = {
  default: '',
  warning: 'border-l-4 border-l-orange-500',
  danger: 'border-l-4 border-l-red-500',
}

export function StatCard({
  title,
  value,
  icon,
  trend,
  variant = 'default',
}: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl bg-gray-900 p-4',
        variantClasses[variant],
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
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
                  trend.isPositive
                    ? 'text-emerald-400'
                    : 'rotate-180 text-red-400',
                )}
              >
                <path
                  d="M7 2L12 8H2L7 2Z"
                  fill="currentColor"
                />
              </svg>
              <span
                className={cn(
                  'text-xs font-medium',
                  trend.isPositive ? 'text-emerald-400' : 'text-red-400',
                )}
              >
                {Math.abs(trend.value)}%
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg bg-gray-800 text-orange-500',
              variant === 'danger' && 'animate-pulse',
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
