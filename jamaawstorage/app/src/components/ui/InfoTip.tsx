import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

interface InfoTipProps {
  text: string
}

export function InfoTip({ text }: InfoTipProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null)

  const updatePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    const width = 288
    const margin = 16
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, margin),
      window.innerWidth - width - margin,
    )
    const bottomTop = rect.bottom + 8
    const estimatedHeight = 104
    const opensAbove = bottomTop + estimatedHeight > window.innerHeight - margin

    setPosition({
      left,
      top: opensAbove ? Math.max(rect.top - estimatedHeight - 8, margin) : bottomTop,
      placement: opensAbove ? 'top' : 'bottom',
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    updatePosition()

    const handlePointerDown = (event: PointerEvent) => {
      if (buttonRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, updatePosition])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setIsOpen((current) => !current)
          window.requestAnimationFrame(updatePosition)
        }}
        className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-none border text-ink-mute transition-colors focus:outline-none focus:ring-2 focus:ring-ink/30 ${
          isOpen
            ? 'border-ink bg-surface text-ink'
            : 'border-line bg-surface hover:border-ink-mute hover:text-ink-dim'
        }`}
        aria-label="Informacao"
        aria-expanded={isOpen}
      >
        <Info size={12} />
      </button>
      {isOpen && position ? createPortal(
        <div
          className="fixed z-[80] w-72 rounded-none border border-line bg-surface p-3 text-xs leading-relaxed text-ink-dim shadow-2xl shadow-black/45"
          style={{ left: position.left, top: position.top }}
          role="tooltip"
        >
          <div
            className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-line bg-surface ${
              position.placement === 'bottom'
                ? '-top-1.5 border-l border-t'
                : '-bottom-1.5 border-b border-r'
            }`}
          />
          <p className="relative">{text}</p>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
