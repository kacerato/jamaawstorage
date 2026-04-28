import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { KitWithItems } from '../../types'
import { Spinner, Badge } from '../../components/ui'
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
      <p className="py-4 text-center text-sm text-gray-400">
        Nenhum kit disponível
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {kits.map((kit) => {
        const isExpanded = expandedId === kit.id
        const itemCount = kit.kit_items?.length ?? 0

        return (
          <div
            key={kit.id}
            className="rounded-lg border border-gray-700 bg-gray-900"
          >
            <button
              type="button"
              onClick={() => toggleExpand(kit.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-800"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-orange-500/20">
                <KitIcon size={16} className="text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {kit.name}
                </p>
                {kit.description && (
                  <p className="truncate text-xs text-gray-400">
                    {kit.description}
                  </p>
                )}
              </div>
              <Badge variant="primary" size="sm">
                {itemCount} {itemCount === 1 ? 'item' : 'itens'}
              </Badge>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={`text-gray-400 transition-transform ${
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
              <div className="border-t border-gray-700 px-4 py-3">
                <div className="mb-3 flex flex-col gap-1">
                  {kit.kit_items?.map((ki) => (
                    <div
                      key={ki.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-gray-300">
                        {ki.stock_items?.name ?? 'Item'}
                      </span>
                      <span className="text-gray-400">
                        {ki.quantity} {ki.stock_items?.unit ?? 'un'}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(kit)}
                  className="w-full rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
                >
                  Usar este Kit
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
