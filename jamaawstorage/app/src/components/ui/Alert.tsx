import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

type AlertVariant = 'info' | 'warning' | 'danger' | 'success'

interface AlertProps {
  variant: AlertVariant
  title?: string
  children: ReactNode
  icon?: ReactNode
  dismissible?: boolean
  onDismiss?: () => void
  className?: string
}

const variantClasses: Record<AlertVariant, string> = {
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  danger: 'bg-red-500/10 border-red-500/30 text-red-300',
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  info: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
}

const defaultIcons: Record<AlertVariant, ReactNode> = {
  warning: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 2L18.66 17H1.34L10 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M10 8V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  ),
  danger: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M10 6V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  ),
  success: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M6.5 10.5L9 13L13.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  info: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M10 8V8.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M10 11V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
}

export function Alert({
  variant,
  title,
  children,
  icon,
  dismissible = false,
  onDismiss,
  className,
}: AlertProps) {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) return null

  const handleDismiss = () => {
    setIsVisible(false)
    onDismiss?.()
  }

  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border p-4',
        variantClasses[variant],
        className,
      )}
      role="alert"
    >
      <div className="flex-shrink-0">{icon ?? defaultIcons[variant]}</div>
      <div className="flex-1">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        <div className="text-sm">{children}</div>
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100"
          aria-label="Dispensar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
