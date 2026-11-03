import logoJamaaw from '../../assets/logojamaaw.png'
import { cn } from '../../lib/utils'

interface BrandMarkProps {
  compact?: boolean
  className?: string
}

export function BrandMark({ compact = false, className }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-3', compact && 'gap-2', className)}>
      <div className={cn(
        'flex items-center justify-center rounded-none border border-line    to-transparent',
        compact ? 'h-10 w-10 rounded-none' : 'h-12 w-12'
      )}>
        <img
          src={logoJamaaw}
          alt="JamaaW"
          className={cn('object-contain', compact ? 'h-7 w-7' : 'h-8 w-8')}
          draggable={false}
        />
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-ink">
            JamaaW
          </p>
          <p className=" bg-clip-text text-lg font-semibold text-transparent">
            Storage
          </p>
        </div>
      )}
    </div>
  )
}
