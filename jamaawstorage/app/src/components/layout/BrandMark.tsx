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
        'flex items-center justify-center rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/20 via-orange-400/10 to-transparent shadow-[0_16px_40px_rgba(249,115,22,0.18)]',
        compact ? 'h-10 w-10 rounded-xl' : 'h-12 w-12'
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-orange-300/80">
            JamaaW
          </p>
          <p className="bg-gradient-to-r from-white via-orange-100 to-orange-300 bg-clip-text text-lg font-semibold text-transparent">
            Storage
          </p>
        </div>
      )}
    </div>
  )
}
