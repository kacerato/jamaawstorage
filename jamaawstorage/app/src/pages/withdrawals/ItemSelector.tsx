import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'
import { Input, Badge, Spinner } from '../../components/ui'
import { PackageIcon } from '../../components/icons'

type StockItemRow = Tables<'stock_items'>

interface ItemSelectorProps {
  onSelect: (item: StockItemRow) => void
  selectedIds: Set<string>
}

export function ItemSelector({ onSelect, selectedIds }: ItemSelectorProps) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<StockItemRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchItems = async () => {
      setLoading(true)
      let queryBuilder = supabase
        .from('stock_items')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (search.trim()) {
        queryBuilder = queryBuilder.or(
          `name.ilike.%${search}%,code.ilike.%${search}%,category.ilike.%${search}%`
        )
      }

      const { data, error } = await queryBuilder.limit(50)

      if (cancelled) return
      if (error) {
        console.error('Error fetching stock items:', error.message)
        setItems([])
      } else {
        setItems((data as StockItemRow[]) ?? [])
      }
      setLoading(false)
    }

    const timeout = setTimeout(() => {
      fetchItems()
    }, 300)

    return () => {
      clearTimeout(timeout)
      cancelled = true
    }
  }, [search])

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Buscar item por nome, código ou categoria..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        leftIcon={<PackageIcon size={16} />}
      />

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      )}

      {!loading && items.length === 0 && search.trim() !== '' && (
        <p className="py-4 text-center text-sm text-gray-400">
          Nenhum item encontrado para &quot;{search}&quot;
        </p>
      )}

      {!loading && items.length === 0 && search.trim() === '' && (
        <p className="py-4 text-center text-sm text-gray-400">
          Digite para buscar itens do estoque
        </p>
      )}

      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-700">
        {items.map((item) => {
          const alreadySelected = selectedIds.has(item.id)
          const isLowStock = item.minimum_quantity > 0 && item.current_quantity <= item.minimum_quantity

          return (
            <button
              key={item.id}
              type="button"
              disabled={alreadySelected}
              onClick={() => onSelect(item)}
              className={`flex w-full items-center gap-3 border-b border-gray-800 px-4 py-3 text-left transition-colors last:border-b-0 ${
                alreadySelected
                  ? 'cursor-not-allowed opacity-40'
                  : 'cursor-pointer hover:bg-gray-800'
              }`}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-800">
                <PackageIcon size={16} className="text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {item.name}
                </p>
                <p className="truncate text-xs text-gray-400">
                  {item.category ?? 'Sem categoria'}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {isLowStock && (
                  <Badge variant="danger" size="sm">
                    Baixo
                  </Badge>
                )}
                <span className="text-sm text-gray-300">
                  {item.current_quantity} {item.unit}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
