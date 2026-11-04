import { cn } from '../../lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className={cn('mb-4 text-ink-mute')}>{icon}</div>}
      <h3 className="mb-1 text-base font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mb-4 max-w-sm text-sm text-ink-dim">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="min-h-touch rounded-none bg-blaze px-4 text-sm font-semibold text-blaze-ink transition-colors hover:bg-blaze/90"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
