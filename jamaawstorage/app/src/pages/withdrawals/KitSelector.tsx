import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { KitWithItems } from '../../types'
import { Spinner, Badge } from '../../components/ui'
import { ItemVisual } from '../../components/items/ItemVisual'
import { KitIcon } from '../../components/icons'

interface KitSelectorProps {
  onSelect: (kit: KitWithItems) => void
}

export function KitSelector({ onSelect }: KitSelectorProps) {
  const [kits, setKits] = useState<KitWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    supabase
      .from('kits')
      .select('*, kit_items(*, stock_items(*))')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Error fetching kits:', error.message)
          setKits([])
        } else {
          setKits((data as KitWithItems[]) ?? [])
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const toggleExpand = (kitId: string) => {
    setExpandedId((prev) => (prev === kitId ? null : kitId))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    )
  }

  if (kits.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-ink-dim">
        Nenhum kit disponível
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {kits.map((kit) => {
        const isExpanded = expandedId === kit.id
        const itemCount = kit.kit_items?.length ?? 0
        const shortages = (kit.kit_items ?? []).filter((item) =>
          !item.stock_items || item.stock_items.current_quantity < item.quantity,
        )
        const isComplete = shortages.length === 0

        return (
          <div
            key={kit.id}
            className="rounded-none border border-line bg-surface"
          >
            <button
              type="button"
              onClick={() => toggleExpand(kit.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-none bg-surface">
                <KitIcon size={16} className="text-ink" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {kit.name}
                </p>
                {kit.description && (
                  <p className="truncate text-xs text-ink-dim">
                    {kit.description}
                  </p>
                )}
              </div>
              <Badge variant="primary" size="sm">
                {itemCount} {itemCount === 1 ? 'item' : 'itens'}
              </Badge>
              <Badge variant={isComplete ? 'success' : 'warning'} size="sm">
                {isComplete ? 'Completo' : 'Parcial disponível'}
              </Badge>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={`text-ink-dim transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              >
                <path
                  d="M4 6L8 10L12 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-line px-4 py-3">
                <div className="mb-3 flex flex-col gap-1">
                  {kit.kit_items?.map((ki) => {
                    const availableQuantity = ki.stock_items?.current_quantity ?? 0
                    const missingQuantity = Math.max(ki.quantity - availableQuantity, 0)
                    return (
                    <div
                      key={ki.id}
                      className="flex items-center justify-between gap-3 rounded-none border border-line bg-surface px-3 py-2 text-sm"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ItemVisual iconKey={ki.stock_items?.svg_icon_key} size={18} />
                        <span className="truncate text-ink-dim">
                          {ki.stock_items?.name ?? 'Item'}
                        </span>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-ink-dim">Kit: {ki.quantity} {ki.stock_items?.unit ?? 'un'}</p>
                        <p className={missingQuantity > 0 ? 'text-warn' : 'text-ok'}>
                          {missingQuantity > 0
                            ? `Disponível ${availableQuantity}; faltam ${missingQuantity}`
                            : `Disponível ${availableQuantity}`}
                        </p>
                      </div>
                    </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(kit)}
                  className="w-full rounded-none bg-blaze px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-blaze"
                >
                  {isComplete ? 'Usar este Kit' : 'Usar o que está disponível'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
