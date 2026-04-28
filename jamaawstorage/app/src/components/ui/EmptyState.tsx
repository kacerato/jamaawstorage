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
      {icon && <div className={cn('mb-4 text-gray-600')}>{icon}</div>}
      <h3 className="mb-1 text-base font-semibold text-gray-300">{title}</h3>
      {description && (
        <p className="mb-4 max-w-sm text-sm text-gray-400">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
