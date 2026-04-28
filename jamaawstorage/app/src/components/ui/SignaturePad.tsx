import { useRef, useEffect, useState, useCallback } from 'react'
import { cn } from '../../lib/utils'

interface SignaturePadProps {
  value: string
  onChange: (signature: string) => void
  label: string
  placeholder?: string
  required?: boolean
  width?: number
  height?: number
  disabled?: boolean
}

export function SignaturePad({
  value,
  onChange,
  label,
  placeholder = 'Assine aqui',
  required = false,
  width = 400,
  height = 150,
  disabled = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const getContext = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvas.getContext('2d')
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 2.5

    if (value) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height)
        setHasDrawn(true)
      }
      img.src = value
    }
  }, [width, height, value])

  const getPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()

      if ('touches' in e) {
        const touch = e.touches[0]
        return {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        }
      }

      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    },
    [],
  )

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return
      e.preventDefault()
      const ctx = getContext()
      if (!ctx) return

      const { x, y } = getPos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
      setIsDrawing(true)
    },
    [disabled, getContext, getPos],
  )

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || disabled) return
      e.preventDefault()
      const ctx = getContext()
      if (!ctx) return

      const { x, y } = getPos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
    },
    [isDrawing, disabled, getContext, getPos],
  )

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return
    setIsDrawing(false)
    setHasDrawn(true)

    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    onChange(dataUrl)
  }, [isDrawing, onChange])

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)
    setHasDrawn(false)
    onChange('')
  }, [width, height, onChange])

  const handleConfirm = useCallback(() => {
    if (!hasDrawn) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    onChange(dataUrl)
  }, [hasDrawn, onChange])

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-300">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      <div className="relative inline-block">
        <canvas
          ref={canvasRef}
          className={cn(
            'rounded-lg border-2 border-dashed bg-white',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair',
            hasDrawn ? 'border-emerald-500' : 'border-gray-600',
          )}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasDrawn && !disabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-gray-400">{placeholder}</span>
          </div>
        )}
        {hasDrawn && (
          <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2.5 6.5L5 9L9.5 3.5"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled || !hasDrawn}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            'bg-gray-800 text-gray-300 hover:bg-gray-700',
            (disabled || !hasDrawn) && 'pointer-events-none opacity-50',
          )}
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={disabled || !hasDrawn}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            'bg-orange-500 text-white hover:bg-orange-600',
            (disabled || !hasDrawn) && 'pointer-events-none opacity-50',
          )}
        >
          Confirmar
        </button>
      </div>
    </div>
  )
}
