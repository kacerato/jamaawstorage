import { useMemo, useState } from 'react'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { Badge, Input } from '../ui'
import { PackageIcon } from '../icons'
import { ItemVisual } from './ItemVisual'
import { cn } from '../../lib/utils'

interface StockItemPickerRow {
  id: string
  name: string
  code?: string | null
  unit: string
  current_quantity: number
  minimum_quantity: number
  category: string | null
  svg_icon_key: string | null
}

interface StockItemPickerProps<TItem extends StockItemPickerRow> {
  items: TItem[]
  onSelect: (item: TItem) => void
  selectedId?: string
  disabledIds?: Set<string>
  searchPlaceholder?: string
  emptyMessage?: string
}

export function StockItemPicker<TItem extends StockItemPickerRow>({
  items,
  onSelect,
  selectedId,
  disabledIds,
  searchPlaceholder = 'Buscar item por nome, codigo ou categoria...',
  emptyMessage = 'Nenhum item disponivel no estoque.',
}: StockItemPickerProps<TItem>) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 180)

  const filteredItems = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()
    if (!term) return items

    return items.filter((item) => {
      const haystack = [
        item.name,
        item.code ?? '',
        item.category ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(term)
    })
  }, [debouncedSearch, items])

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder={searchPlaceholder}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        leftIcon={<PackageIcon size={16} />}
      />

      {filteredItems.length === 0 ? (
        <div className="rounded-none border border-dashed border-line bg-void px-4 py-8 text-center text-sm text-ink-mute">
          {search.trim() ? `Nenhum item encontrado para "${search}".` : emptyMessage}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-none border border-line bg-void/90">
          {filteredItems.map((item) => {
            const disabled = disabledIds?.has(item.id) ?? false
            const active = selectedId === item.id
            const lowStock = item.minimum_quantity > 0 && item.current_quantity <= item.minimum_quantity

            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(item)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0',
                  disabled
                    ? 'cursor-not-allowed opacity-45'
                    : active
                      ? 'bg-surface'
                      : 'hover:bg-surface',
                )}
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-none border border-line bg-surface">
                  <ItemVisual iconKey={item.svg_icon_key} size={26} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                    {item.code ? (
                      <span className="rounded-none border border-line bg-void px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-ink-dim">
                        {item.code}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-mute">
                    {item.category ?? 'Sem categoria'} • {item.unit}
                  </p>
                </div>

                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    {lowStock ? (
                      <Badge variant="danger" size="sm">
                        Baixo
                      </Badge>
                    ) : null}
                    {active ? (
                      <Badge variant="primary" size="sm">
                        Selecionado
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-sm text-ink-dim">
                    {item.current_quantity} {item.unit}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
