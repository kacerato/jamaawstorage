import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatQuantity } from '../../lib/utils'
import { Alert, Button, InfoTip, Input, SectionLabel, Select } from '../../components/ui'
import { ItemVisual } from '../../components/items/ItemVisual'
import { StockItemPicker } from '../../components/items/StockItemPicker'

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
  svg_icon_key: string | null
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
        .select('id, name, unit, current_quantity, minimum_quantity, category, svg_icon_key, is_active')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('kits')
        .select('id, name, kit_items(stock_item_id, quantity, stock_items(id, name, unit, current_quantity, minimum_quantity, category, svg_icon_key, is_active))')
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
  }, [personId])

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

  const totalRequestedUnits = useMemo(
    () => summarizedItems.reduce((sum, item) => sum + item.quantity, 0),
    [summarizedItems],
  )

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
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <span>Inventario de <span className="font-medium text-white">{personName}</span></span>
        <InfoTip text="Monte uma fila com itens avulsos ou kits. Ao confirmar, o estoque baixa e o inventario da pessoa aumenta na mesma operacao." />
      </div>
      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        </div>
      ) : availableItems.length === 0 && availableKits.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          Nenhum item ou kit ativo com saldo disponivel no estoque.
        </p>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_340px]">
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-white/8 bg-[#111217] p-4">
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <div className="min-w-[180px] flex-1">
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
                  </div>

                  <div className="min-w-[220px] flex-[1.4]">
                    {draftType === 'item' ? (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-gray-300">Item do Estoque</label>
                        <StockItemPicker
                          items={availableItems}
                          selectedId={selectedItemId}
                          onSelect={(item) => {
                            setSelectedItemId(item.id)
                            setError(null)
                          }}
                          searchPlaceholder="Buscar item por nome, codigo ou categoria..."
                          emptyMessage="Nenhum item ativo com saldo disponivel."
                        />
                      </div>
                    ) : (
                      <Select
                        label="Kit"
                        value={selectedKitId}
                        onChange={(e) => setSelectedKitId(e.target.value)}
                        options={kitOptions}
                        placeholder="Selecione um kit"
                      />
                    )}
                  </div>

                  <div className="min-w-[120px]">
                    <Input
                      label={draftType === 'item' ? 'Quantidade' : 'Qtd de Kits'}
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="1"
                    />
                  </div>

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

                {selectedItem && draftType === 'item' && (
                  <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-400/15 bg-orange-500/10">
                        <ItemVisual iconKey={selectedItem.svg_icon_key} size={28} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{selectedItem.name}</p>
                        <p className="mt-1 text-xs text-gray-500">{selectedItem.category ?? 'Sem categoria'} • {selectedItem.unit}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                      <span className="rounded-full border border-white/8 bg-black/10 px-3 py-1">
                        Estoque atual: {selectedItem.current_quantity}
                      </span>
                      <span className="rounded-full border border-white/8 bg-black/10 px-3 py-1">
                        Minimo: {selectedItem.minimum_quantity}
                      </span>
                      {selectedItem.current_quantity <= selectedItem.minimum_quantity && (
                        <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 font-medium text-amber-300">
                          Estoque baixo
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {selectedKit && draftType === 'kit' && selectedKitAvailability && (
                  <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{selectedKit.name}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Maximo disponivel: {selectedKitAvailability.maxAssemblies} kit(s)
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                        {selectedKit.kit_items.length} item(ns)
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {selectedKit.kit_items.map((kitItem) => (
                        <div key={`${selectedKit.id}-${kitItem.stock_item_id}`} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                          <ItemVisual iconKey={kitItem.stock_items?.svg_icon_key} size={24} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-white">{kitItem.stock_items?.name ?? 'Item'}</p>
                            <p className="text-xs text-gray-500">
                              {kitItem.quantity} {kitItem.stock_items?.unit ?? 'un'} por kit • saldo {kitItem.stock_items?.current_quantity ?? 0}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/8 bg-[#111217] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Fila</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{pendingEntries.length}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-[#111217] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Unidades</p>
                  <p className="mt-2 text-2xl font-semibold text-orange-300">{totalRequestedUnits}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-[#111217]">
                <div className="border-b border-white/8 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">Fila de atribuicao</h4>
                    <InfoTip text="A fila junta itens e kits antes de confirmar. Voce pode remover entradas sem afetar o estoque." />
                  </div>
                </div>
                {pendingEntries.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-gray-500">
                    Nenhum item adicionado ainda.
                  </p>
                ) : (
                  <div className="max-h-[42vh] space-y-3 overflow-y-auto p-4">
                    {pendingEntries.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-white/8 bg-white/4 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium text-white">{entry.name}</span>
                              <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                                {entry.type === 'kit' ? `${entry.requestedQuantity} kit(s)` : `${entry.requestedQuantity} item(ns)`}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-col gap-2">
                              {entry.items.map((item) => (
                                <div key={`${entry.id}-${item.stock_item_id}`} className="flex items-center justify-between text-sm">
                                  <span className="truncate pr-3 text-gray-300">{item.name}</span>
                                  <span className="text-orange-300">{formatQuantity(item.quantity, item.unit)}</span>
                                </div>
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
                <div className="rounded-2xl border border-emerald-400/10 bg-emerald-500/5 p-4 text-sm text-gray-300">
                  <SectionLabel label="Resumo final" info="Quantidade total que sera atribuida ao inventario dessa pessoa." />
                  <div className="mt-3 flex max-h-40 flex-col gap-2 overflow-y-auto">
                    {summarizedItems.map((item) => (
                      <div key={item.stock_item_id} className="flex items-center justify-between gap-3">
                        <span className="truncate">{item.name}</span>
                        <span className="font-medium text-orange-400">{formatQuantity(item.quantity, item.unit)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

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
