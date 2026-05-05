import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatQuantity } from '../../lib/utils'
import { Alert, Button, Input, Select } from '../../components/ui'

interface PersonInventoryModalProps {
  onClose: () => void
  personId: string
  personName: string
  onAdded: () => void
}

interface StockItemOption {
  id: string
  name: string
  unit: string
  current_quantity: number
  minimum_quantity: number
  category: string | null
  is_active: boolean
}

interface KitItemOption {
  stock_item_id: string
  quantity: number
  stock_items: StockItemOption | null
}

interface KitOption {
  id: string
  name: string
  kit_items: KitItemOption[]
}

interface PendingInventoryItem {
  stock_item_id: string
  name: string
  unit: string
  quantity: number
}

interface PendingInventoryEntry {
  id: string
  type: 'item' | 'kit'
  name: string
  requestedQuantity: number
  items: PendingInventoryItem[]
}

type DraftSourceType = 'item' | 'kit'

function getKitAvailability(kit: KitOption): {
  maxAssemblies: number
  blockingItems: string[]
} {
  if (!kit.kit_items.length) {
    return { maxAssemblies: 0, blockingItems: ['Kit vazio'] }
  }

  const perItemAvailability = kit.kit_items.map((kitItem) => {
    const stockItem = kitItem.stock_items
    if (!stockItem || !stockItem.is_active) {
      return {
        name: stockItem?.name ?? 'Item inativo',
        maxAssemblies: 0,
      }
    }

    return {
      name: stockItem.name,
      maxAssemblies: Math.floor(stockItem.current_quantity / kitItem.quantity),
    }
  })

  const maxAssemblies = perItemAvailability.reduce((lowest, current) => {
    return Math.min(lowest, current.maxAssemblies)
  }, Number.POSITIVE_INFINITY)

  return {
    maxAssemblies: Number.isFinite(maxAssemblies) ? maxAssemblies : 0,
    blockingItems: perItemAvailability.filter((item) => item.maxAssemblies <= 0).map((item) => item.name),
  }
}

function buildItemEntry(item: StockItemOption, quantity: number): PendingInventoryEntry {
  return {
    id: `${item.id}-${Date.now()}`,
    type: 'item',
    name: item.name,
    requestedQuantity: quantity,
    items: [
      {
        stock_item_id: item.id,
        name: item.name,
        unit: item.unit,
        quantity,
      },
    ],
  }
}

function buildKitEntry(kit: KitOption, quantity: number): PendingInventoryEntry {
  return {
    id: `${kit.id}-${Date.now()}`,
    type: 'kit',
    name: kit.name,
    requestedQuantity: quantity,
    items: kit.kit_items
      .filter((kitItem) => kitItem.stock_items?.is_active)
      .map((kitItem) => ({
        stock_item_id: kitItem.stock_item_id,
        name: kitItem.stock_items?.name ?? 'Item',
        unit: kitItem.stock_items?.unit ?? 'un',
        quantity: kitItem.quantity * quantity,
      })),
  }
}

export function PersonInventoryModal({
  onClose,
  personId,
  personName,
  onAdded,
}: PersonInventoryModalProps) {
  const [stockItems, setStockItems] = useState<StockItemOption[]>([])
  const [kits, setKits] = useState<KitOption[]>([])
  const [draftType, setDraftType] = useState<DraftSourceType>('item')
  const [selectedItemId, setSelectedItemId] = useState('')
  const [selectedKitId, setSelectedKitId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [pendingEntries, setPendingEntries] = useState<PendingInventoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSources = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [stockRes, kitsRes] = await Promise.all([
      supabase
        .from('stock_items')
        .select('id, name, unit, current_quantity, minimum_quantity, category, is_active')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('kits')
        .select('id, name, kit_items(stock_item_id, quantity, stock_items(id, name, unit, current_quantity, minimum_quantity, category, is_active))')
        .eq('is_active', true)
        .order('name'),
    ])

    if (stockRes.error) {
      setError(stockRes.error.message)
      setLoading(false)
      return
    }

    if (kitsRes.error) {
      setError(kitsRes.error.message)
      setLoading(false)
      return
    }

    setStockItems((stockRes.data ?? []) as StockItemOption[])
    setKits(((kitsRes.data ?? []) as KitOption[]).map((kit) => ({
      ...kit,
      kit_items: (kit.kit_items ?? []).filter((kitItem) => kitItem.stock_items?.is_active),
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchSources()
    setDraftType('item')
    setSelectedItemId('')
    setSelectedKitId('')
    setQuantity('1')
    setPendingEntries([])
    setError(null)
  }, [fetchSources, personId])

  const availableItems = useMemo(
    () => stockItems.filter((item) => item.current_quantity > 0),
    [stockItems],
  )
  const availableKits = useMemo(
    () => kits.filter((kit) => getKitAvailability(kit).maxAssemblies > 0),
    [kits],
  )

  const selectedItem = availableItems.find((item) => item.id === selectedItemId)
  const selectedKit = availableKits.find((kit) => kit.id === selectedKitId)
  const parsedQuantity = Number(quantity)
  const selectedKitAvailability = selectedKit ? getKitAvailability(selectedKit) : null

  const stockOptions = availableItems.map((item) => ({
    value: item.id,
    label: `${item.name} (${item.unit})`,
  }))

  const kitOptions = availableKits.map((kit) => {
    const availability = getKitAvailability(kit)
    return {
      value: kit.id,
      label: `${kit.name} (${availability.maxAssemblies} kit(s) disponivel(is))`,
    }
  })

  const summarizedItems = useMemo(() => {
    const grouped = new Map<string, PendingInventoryItem>()

    for (const entry of pendingEntries) {
      for (const item of entry.items) {
        const current = grouped.get(item.stock_item_id)
        if (current) {
          current.quantity += item.quantity
        } else {
          grouped.set(item.stock_item_id, { ...item })
        }
      }
    }

    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [pendingEntries])

  const addDraftEntry = () => {
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError('Informe uma quantidade valida maior que zero.')
      return
    }

    if (draftType === 'item') {
      if (!selectedItem) {
        setError('Selecione um item do estoque.')
        return
      }

      if (parsedQuantity > selectedItem.current_quantity) {
        setError(`Estoque insuficiente. Disponivel agora: ${selectedItem.current_quantity} ${selectedItem.unit}.`)
        return
      }

      setPendingEntries((current) => [...current, buildItemEntry(selectedItem, parsedQuantity)])
      setSelectedItemId('')
      setQuantity('1')
      setError(null)
      return
    }

    if (!selectedKit || !selectedKitAvailability) {
      setError('Selecione um kit.')
      return
    }

    if (parsedQuantity > selectedKitAvailability.maxAssemblies) {
      setError(`Kit sem saldo suficiente. Maximo disponivel agora: ${selectedKitAvailability.maxAssemblies}.`)
      return
    }

    setPendingEntries((current) => [...current, buildKitEntry(selectedKit, parsedQuantity)])
    setSelectedKitId('')
    setQuantity('1')
    setError(null)
  }

  const removePendingEntry = (entryId: string) => {
    setPendingEntries((current) => current.filter((entry) => entry.id !== entryId))
  }

  const handleSubmit = async () => {
    if (summarizedItems.length === 0) {
      setError('Adicione ao menos um item ou kit antes de confirmar.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: assignError } = await supabase.rpc('assign_inventory_items_to_person', {
      p_person_id: personId,
      p_items: summarizedItems.map((item) => ({
        stock_item_id: item.stock_item_id,
        quantity: item.quantity,
      })),
    })

    if (assignError) {
      setError(assignError.message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    onClose()
    onAdded()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-400">
        Adicionar itens ou kits ao inventario de <span className="font-medium text-white">{personName}</span>
      </p>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        </div>
      ) : availableItems.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          Nenhum item ativo com saldo disponivel no estoque.
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_120px]">
            <Select
              label="Origem"
              value={draftType}
              onChange={(e) => {
                setDraftType(e.target.value as DraftSourceType)
                setSelectedItemId('')
                setSelectedKitId('')
                setError(null)
              }}
              options={[
                { value: 'item', label: 'Item avulso' },
                { value: 'kit', label: 'Kit' },
              ]}
            />

            {draftType === 'item' ? (
              <Select
                label="Item do Estoque"
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                options={stockOptions}
                placeholder="Selecione um item"
              />
            ) : (
              <Select
                label="Kit"
                value={selectedKitId}
                onChange={(e) => setSelectedKitId(e.target.value)}
                options={kitOptions}
                placeholder="Selecione um kit"
              />
            )}

            <Input
              label={draftType === 'item' ? 'Quantidade' : 'Qtd de Kits'}
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="1"
            />
          </div>

          {selectedItem && draftType === 'item' && (
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{selectedItem.name}</span>
                <span className="text-gray-400">{selectedItem.unit}</span>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-gray-500">
                <span>Estoque atual: {selectedItem.current_quantity}</span>
                <span>Minimo: {selectedItem.minimum_quantity}</span>
                {selectedItem.current_quantity <= selectedItem.minimum_quantity && (
                  <span className="font-medium text-amber-400">Estoque baixo!</span>
                )}
              </div>
            </div>
          )}

          {selectedKit && draftType === 'kit' && selectedKitAvailability && (
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-white">{selectedKit.name}</span>
                <span className="text-gray-400">
                  Maximo disponivel: {selectedKitAvailability.maxAssemblies}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-sm text-gray-300">
                {selectedKit.kit_items.map((kitItem) => (
                  <div key={`${selectedKit.id}-${kitItem.stock_item_id}`} className="flex items-center justify-between">
                    <span>{kitItem.stock_items?.name ?? 'Item'}</span>
                    <span className="text-gray-400">
                      {kitItem.quantity} {kitItem.stock_items?.unit ?? 'un'} por kit | saldo {kitItem.stock_items?.current_quantity ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={addDraftEntry}
              disabled={
                draftType === 'item'
                  ? !selectedItemId || !quantity || parsedQuantity <= 0
                  : !selectedKitId || !quantity || parsedQuantity <= 0
              }
            >
              Adicionar a fila
            </Button>
          </div>

          <div className="rounded-xl border border-gray-700 bg-gray-900/60">
            <div className="border-b border-gray-700 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Fila de atribuicao</h4>
            </div>
            {pendingEntries.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">
                Nenhum item adicionado ainda.
              </p>
            ) : (
              <div className="space-y-3 p-4">
                {pendingEntries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-gray-700 bg-gray-800/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{entry.name}</span>
                          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                            {entry.type === 'kit' ? `${entry.requestedQuantity} kit(s)` : `${entry.requestedQuantity} item(ns)`}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-col gap-1 text-sm text-gray-400">
                          {entry.items.map((item) => (
                            <span key={`${entry.id}-${item.stock_item_id}`}>
                              {item.name}: {formatQuantity(item.quantity, item.unit)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePendingEntry(entry.id)}
                      >
                        Remover
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {summarizedItems.length > 0 && (
            <div className="rounded-lg bg-gray-800/50 p-3 text-sm text-gray-300">
              <p className="font-medium text-white">Resumo final da movimentacao</p>
              <div className="mt-2 flex flex-col gap-1">
                {summarizedItems.map((item) => (
                  <span key={item.stock_item_id}>
                    {item.name}: <span className="font-medium text-orange-400">{formatQuantity(item.quantity, item.unit)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-gray-700 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              isLoading={submitting}
              disabled={summarizedItems.length === 0}
            >
              Confirmar atribuicao
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
