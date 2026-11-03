import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables, WithdrawalDestinationType } from '../../types/database'
import { Input, Badge, Spinner, Button, Alert, SectionLabel } from '../../components/ui'
import { PackageIcon, UserIcon, ClipboardIcon } from '../../components/icons'
import { ItemVisual } from '../../components/items/ItemVisual'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { cn } from '../../lib/utils'

type StockItemRow = Tables<'stock_items'>
type PeopleRow = Tables<'people'>
type WorkSiteRow = Tables<'work_sites'>

export interface BulkDestinationTarget {
  destination_type: WithdrawalDestinationType
  collaborator_id: string | null
  work_site_id: string | null
}

export interface BulkWithdrawalLine extends BulkDestinationTarget {
  stock_item: StockItemRow
  quantity: number
}

interface BulkItemSelectorProps {
  collaborators: PeopleRow[]
  workSites: WorkSiteRow[]
  /** Obra oferecida como destino. Vazio junto com allWorkSites lista todas as obras ativas. */
  defaultWorkSiteId: string
  /** Oferece todas as obras ativas como destino, nao apenas a obra padrao. */
  allWorkSites?: boolean
  /** Quantidade ja planejada por stock_item_id, para calcular o saldo restante. */
  plannedQuantities: Map<string, number>
  /**
   * Quantidade por stock_item_id que deve ser somada ao estoque atual para formar o saldo
   * editavel. Na edicao de uma retirada ja efetivada, o estoque atual ja foi baixado, entao
   * o que a propria retirada consumiu volta a ficar disponivel.
   */
  stockCreditByItem?: Map<string, number>
  onConfirm: (lines: BulkWithdrawalLine[]) => void
  onCancel: () => void
}

interface SelectedItemState {
  item: StockItemRow
  /** Quantidade aplicada a cada pessoa selecionada. */
  quantityPerTarget: number
  /** Sobrescritas individuais por chave de destino. */
  overrides: Record<string, number>
}

function makeTargetKey(target: BulkDestinationTarget): string {
  return target.destination_type === 'work_site'
    ? `work_site:${target.work_site_id ?? ''}`
    : `collaborator:${target.collaborator_id ?? ''}`
}

const bulkItemCache: { items: StockItemRow[] } = { items: [] }

function quantity(value: number | null | undefined): number {
  return Math.max(0, Number(value ?? 0))
}

export function BulkItemSelector({
  collaborators,
  workSites,
  defaultWorkSiteId,
  allWorkSites = false,
  plannedQuantities,
  stockCreditByItem,
  onConfirm,
  onCancel,
}: BulkItemSelectorProps) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 180)
  const [items, setItems] = useState<StockItemRow[]>(bulkItemCache.items)
  const [loading, setLoading] = useState(bulkItemCache.items.length === 0)

  const [selectedItems, setSelectedItems] = useState<Record<string, SelectedItemState>>({})
  const [selectedTargetKeys, setSelectedTargetKeys] = useState<string[]>([])
  const [peopleSearch, setPeopleSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchItems = useCallback(async (searchTerm: string) => {
    if (bulkItemCache.items.length === 0) setLoading(true)

    let queryBuilder = supabase
      .from('stock_items')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (searchTerm.trim()) {
      queryBuilder = queryBuilder.or(
        `name.ilike.%${searchTerm}%,code.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%`
      )
    }

    const { data, error: queryError } = await queryBuilder.limit(50)

    if (queryError) {
      console.error('Error fetching stock items:', queryError.message)
      setItems([])
    } else {
      const nextItems = (data as StockItemRow[]) ?? []
      bulkItemCache.items = nextItems
      setItems(nextItems)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchItems(debouncedSearch)
  }, [debouncedSearch, fetchItems])

  const availableQuantityFor = useCallback(
    (stockItem: StockItemRow): number => {
      const credit = stockCreditByItem?.get(stockItem.id) ?? 0
      const alreadyPlanned = plannedQuantities.get(stockItem.id) ?? 0
      return Math.max(0, stockItem.current_quantity + credit - alreadyPlanned)
    },
    [plannedQuantities, stockCreditByItem],
  )

  const availableTargets = useMemo<{ key: string; label: string; sublabel: string; target: BulkDestinationTarget }[]>(() => {
    const offeredWorkSites = allWorkSites
      ? workSites
      : workSites.filter((site) => site.id === defaultWorkSiteId)

    return [
      ...offeredWorkSites.map((workSite) => ({
        key: makeTargetKey({ destination_type: 'work_site' as const, collaborator_id: null, work_site_id: workSite.id }),
        label: workSite.name,
        sublabel: 'Obra',
        target: { destination_type: 'work_site' as const, collaborator_id: null, work_site_id: workSite.id },
      })),
      ...collaborators.map((collaborator) => ({
        key: makeTargetKey({ destination_type: 'collaborator' as const, collaborator_id: collaborator.id, work_site_id: null }),
        label: collaborator.full_name,
        sublabel: collaborator.employee_id ?? 'Colaborador',
        target: { destination_type: 'collaborator' as const, collaborator_id: collaborator.id, work_site_id: null },
      })),
    ]
  }, [allWorkSites, collaborators, defaultWorkSiteId, workSites])

  const filteredTargets = useMemo(() => {
    const term = peopleSearch.trim().toLowerCase()
    if (!term) return availableTargets

    return availableTargets.filter((entry) =>
      entry.label.toLowerCase().includes(term) || entry.sublabel.toLowerCase().includes(term),
    )
  }, [availableTargets, peopleSearch])

  const selectedItemsList = useMemo(() => Object.values(selectedItems), [selectedItems])

  const toggleItem = (item: StockItemRow) => {
    setError(null)
    setSelectedItems((prev) => {
      if (prev[item.id]) {
        const next = { ...prev }
        delete next[item.id]
        return next
      }

      return {
        ...prev,
        [item.id]: { item, quantityPerTarget: 1, overrides: {} },
      }
    })
  }

  const toggleTarget = (key: string) => {
    setError(null)
    setSelectedTargetKeys((prev) =>
      prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key],
    )
  }

  const toggleAllFilteredTargets = () => {
    setError(null)
    const filteredKeys = filteredTargets.map((entry) => entry.key)
    const allSelected = filteredKeys.every((key) => selectedTargetKeys.includes(key))

    setSelectedTargetKeys((prev) =>
      allSelected
        ? prev.filter((key) => !filteredKeys.includes(key))
        : Array.from(new Set([...prev, ...filteredKeys])),
    )
  }

  const updateQuantityPerTarget = (stockItemId: string, value: number) => {
    setError(null)
    setSelectedItems((prev) => {
      const current = prev[stockItemId]
      if (!current) return prev
      return {
        ...prev,
        [stockItemId]: { ...current, quantityPerTarget: value, overrides: {} },
      }
    })
  }

  const updateOverride = (stockItemId: string, targetKey: string, value: number) => {
    setError(null)
    setSelectedItems((prev) => {
      const current = prev[stockItemId]
      if (!current) return prev
      return {
        ...prev,
        [stockItemId]: {
          ...current,
          overrides: { ...current.overrides, [targetKey]: value },
        },
      }
    })
  }

  const resolveQuantity = (state: SelectedItemState, targetKey: string): number => {
    const override = state.overrides[targetKey]
    return override === undefined ? state.quantityPerTarget : override
  }

  const totals = useMemo(() => {
    return selectedItemsList.map((state) => {
      const total = selectedTargetKeys.reduce(
        (sum, targetKey) => sum + Math.max(0, resolveQuantity(state, targetKey)),
        0,
      )
      const available = availableQuantityFor(state.item)

      return { state, total, available, exceeds: total > available }
    })
  }, [availableQuantityFor, selectedItemsList, selectedTargetKeys])

  const handleConfirm = () => {
    if (selectedItemsList.length === 0) {
      setError('Selecione ao menos um item.')
      return
    }

    if (selectedTargetKeys.length === 0) {
      setError('Selecione ao menos uma pessoa ou a obra.')
      return
    }

    const exceeded = totals.find((entry) => entry.exceeds)
    if (exceeded) {
      setError(
        `"${exceeded.state.item.name}": a distribuicao soma ${exceeded.total} ${exceeded.state.item.unit}, mas restam apenas ${exceeded.available} em estoque.`,
      )
      return
    }

    const targetByKey = new Map(availableTargets.map((entry) => [entry.key, entry.target]))
    const lines: BulkWithdrawalLine[] = []

    for (const state of selectedItemsList) {
      for (const targetKey of selectedTargetKeys) {
        const target = targetByKey.get(targetKey)
        if (!target) continue

        const lineQuantity = Math.max(0, Math.floor(resolveQuantity(state, targetKey)))
        if (lineQuantity <= 0) continue

        lines.push({ ...target, stock_item: state.item, quantity: lineQuantity })
      }
    }

    if (lines.length === 0) {
      setError('Nenhuma linha gerada. Revise as quantidades.')
      return
    }

    onConfirm(lines)
  }

  const lineCount = totals.reduce(
    (sum, entry) => sum + selectedTargetKeys.filter((key) => resolveQuantity(entry.state, key) > 0).length,
    0,
  )

  return (
    <div className="flex flex-col gap-5">
      <Alert variant="info">
        Escolha os itens uma vez, marque todas as pessoas e o sistema cria uma linha por pessoa automaticamente.
      </Alert>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <SectionLabel
            label={`1. Itens${selectedItemsList.length > 0 ? ` (${selectedItemsList.length} selecionado(s))` : ''}`}
            info="Marque um ou mais itens. Todos serao distribuidos para as pessoas escolhidas ao lado."
          />
          <Input
            placeholder="Buscar item por nome, codigo ou categoria..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            leftIcon={<PackageIcon size={16} />}
          />

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" />
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-700">
              {items.length === 0 && (
                <p className="py-4 text-center text-sm text-gray-400">Nenhum item encontrado.</p>
              )}
              {items.map((item) => {
                const isSelected = Boolean(selectedItems[item.id])
                const available = availableQuantityFor(item)

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleItem(item)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-gray-800 px-3 py-2.5 text-left transition-colors last:border-b-0',
                      isSelected ? 'bg-orange-500/12' : 'hover:bg-gray-800',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
                        isSelected ? 'border-orange-400 bg-orange-500' : 'border-gray-600 bg-gray-900',
                      )}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-800">
                      <ItemVisual iconKey={item.svg_icon_key} size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{item.name}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge variant="success" size="sm">Novo {quantity(item.quantity_new)}</Badge>
                        <Badge variant="info" size="sm">Usado {quantity(item.quantity_used)}</Badge>
                        <Badge variant="danger" size="sm">Avaria {quantity(item.quantity_damaged)}</Badge>
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-xs text-gray-300">
                      {available} {item.unit}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <SectionLabel
              label={`2. Destinos${selectedTargetKeys.length > 0 ? ` (${selectedTargetKeys.length} selecionado(s))` : ''}`}
              info="Cada pessoa marcada recebe os itens selecionados em seu inventario individual."
            />
            {filteredTargets.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={toggleAllFilteredTargets}>
                {filteredTargets.every((entry) => selectedTargetKeys.includes(entry.key))
                  ? 'Limpar visiveis'
                  : 'Selecionar visiveis'}
              </Button>
            )}
          </div>
          <Input
            placeholder="Buscar pessoa ou obra..."
            value={peopleSearch}
            onChange={(event) => setPeopleSearch(event.target.value)}
            leftIcon={<UserIcon size={16} />}
          />

          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-700">
            {filteredTargets.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-400">Nenhum destino encontrado.</p>
            )}
            {filteredTargets.map((entry) => {
              const isSelected = selectedTargetKeys.includes(entry.key)
              const isWorkSite = entry.target.destination_type === 'work_site'

              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => toggleTarget(entry.key)}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-gray-800 px-3 py-2.5 text-left transition-colors last:border-b-0',
                    isSelected ? 'bg-orange-500/12' : 'hover:bg-gray-800',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
                      isSelected ? 'border-orange-400 bg-orange-500' : 'border-gray-600 bg-gray-900',
                    )}
                  >
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-800 text-gray-400">
                    {isWorkSite ? <ClipboardIcon size={16} /> : <UserIcon size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{entry.label}</p>
                    <p className="truncate text-xs text-gray-500">{entry.sublabel}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {selectedItemsList.length > 0 && selectedTargetKeys.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel
            label="3. Quantidades"
            info="Defina a quantidade por pessoa. Se alguem precisar de um numero diferente, ajuste na lista individual."
          />

          <div className="space-y-3">
            {totals.map(({ state, total, available, exceeds }) => {
              const hasOverrides = Object.keys(state.overrides).length > 0

              return (
                <div
                  key={state.item.id}
                  className={cn(
                    'rounded-2xl border p-4',
                    exceeds ? 'border-red-500/40 bg-red-500/6' : 'border-white/8 bg-white/3',
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{state.item.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Disponivel: {available} {state.item.unit}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-400">Qtd por pessoa</label>
                      <input
                        type="number"
                        min={0}
                        value={state.quantityPerTarget}
                        onChange={(event) => {
                          const value = parseInt(event.target.value, 10)
                          if (!Number.isNaN(value) && value >= 0) {
                            updateQuantityPerTarget(state.item.id, value)
                          }
                        }}
                        className="w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-center text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                      />
                      <Badge variant={exceeds ? 'danger' : 'default'} size="sm">
                        Total {total} {state.item.unit}
                      </Badge>
                    </div>
                  </div>

                  <details className="mt-3" open={hasOverrides}>
                    <summary className="cursor-pointer text-xs text-orange-300 hover:text-orange-200">
                      Ajustar individualmente ({selectedTargetKeys.length} pessoa(s))
                    </summary>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {selectedTargetKeys.map((targetKey) => {
                        const target = availableTargets.find((entry) => entry.key === targetKey)
                        if (!target) return null

                        return (
                          <div
                            key={targetKey}
                            className="flex items-center justify-between gap-2 rounded-xl border border-white/6 bg-gray-900/60 px-3 py-2"
                          >
                            <span className="min-w-0 truncate text-xs text-gray-300">{target.label}</span>
                            <input
                              type="number"
                              min={0}
                              value={resolveQuantity(state, targetKey)}
                              onChange={(event) => {
                                const value = parseInt(event.target.value, 10)
                                if (!Number.isNaN(value) && value >= 0) {
                                  updateOverride(state.item.id, targetKey, value)
                                }
                              }}
                              className="w-16 flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-center text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </details>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
        <span className="text-sm text-gray-400">
          {lineCount > 0
            ? `${lineCount} linha(s) serao adicionadas a retirada`
            : 'Selecione itens e pessoas para continuar'}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm} disabled={lineCount === 0}>
            Adicionar a retirada
          </Button>
        </div>
      </div>
    </div>
  )
}
