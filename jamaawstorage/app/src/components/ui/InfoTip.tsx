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
        className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-lg border text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/35 ${
          isOpen
            ? 'border-orange-400/45 bg-orange-500/15 text-orange-200'
            : 'border-white/10 bg-white/5 hover:border-orange-400/35 hover:bg-white/8 hover:text-orange-200'
        }`}
        aria-label="Informacao"
        aria-expanded={isOpen}
      >
        <Info size={12} />
      </button>
      {isOpen && position ? createPortal(
        <div
          className="fixed z-[80] w-72 rounded-2xl border border-white/10 bg-[#17181c] p-3 text-xs leading-relaxed text-gray-300 shadow-2xl shadow-black/45"
          style={{ left: position.left, top: position.top }}
          role="tooltip"
        >
          <div
            className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-white/10 bg-[#17181c] ${
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
