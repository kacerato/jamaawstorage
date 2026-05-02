import { useEffect, useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  showCloseButton?: boolean
}

const sizeClasses: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw]',
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
}: ModalProps) {
  const [isAnimating, setIsAnimating] = useState(false)
  const shouldRender = isOpen || isAnimating

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        setIsAnimating(true)
      })
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    } else {
      requestAnimationFrame(() => {
      setIsAnimating(false)
    })
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleEscape])

  if (!shouldRender) return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200',
        isAnimating ? 'opacity-100' : 'opacity-0',
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative flex max-h-[90vh] w-full transform flex-col overflow-y-auto rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,_rgba(20,20,24,0.98)_0%,_rgba(12,12,15,0.98)_100%)] shadow-[0_32px_90px_rgba(0,0,0,0.45)] transition-all duration-200',
          sizeClasses[size],
          isAnimating
            ? 'translate-y-0 scale-100 opacity-100'
            : 'translate-y-4 scale-95 opacity-0',
        )}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.12),_transparent_50%)] px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-orange-200/70">
              JamaaW
            </p>
            <h2
              id="modal-title"
              className="mt-1 text-lg font-semibold text-white"
            >
              {title}
            </h2>
          </div>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-white/8 bg-white/4 p-2 text-gray-400 transition-colors hover:bg-white/8 hover:text-white"
              aria-label="Fechar"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5 5L15 15M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
        <div className="flex-1 px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
