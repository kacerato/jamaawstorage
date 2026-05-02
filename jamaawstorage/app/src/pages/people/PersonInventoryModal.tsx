import { useCallback, useEffect, useState } from 'react'
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
}

export function PersonInventoryModal({
  onClose,
  personId,
  personName,
  onAdded,
}: PersonInventoryModalProps) {
  const [stockItems, setStockItems] = useState<StockItemOption[]>([])
  const [selectedItemId, setSelectedItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchStockItems = useCallback(async () => {
    setLoading(true)
    setError(null)

    const stockRes = await supabase
      .from('stock_items')
      .select('id, name, unit, current_quantity, minimum_quantity')
      .eq('is_active', true)
      .order('name')

    if (stockRes.error) {
      setError(stockRes.error.message)
      setLoading(false)
      return
    }

    setStockItems((stockRes.data ?? []) as StockItemOption[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchStockItems()
    setSelectedItemId('')
    setQuantity('')
    setError(null)
  }, [fetchStockItems, personId])

  const availableItems = stockItems.filter((item) => item.current_quantity > 0)
  const selectedItem = stockItems.find((item) => item.id === selectedItemId)

  const handleSubmit = async () => {
    if (!selectedItemId || !quantity || Number(quantity) <= 0) return

    if (selectedItem && Number(quantity) > selectedItem.current_quantity) {
      setError(`Estoque insuficiente. Disponivel agora: ${selectedItem.current_quantity} ${selectedItem.unit}.`)
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.rpc('assign_inventory_item_to_person', {
      p_person_id: personId,
      p_stock_item_id: selectedItemId,
      p_quantity: Number(quantity),
    })

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    onClose()
    onAdded()
  }

  const stockOptions = availableItems.map((item) => ({
    value: item.id,
    label: `${item.name} (${item.unit})`,
  }))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-400">
        Adicionar item ao inventario de <span className="font-medium text-white">{personName}</span>
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
          <Select
            label="Item do Estoque"
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
            options={stockOptions}
            placeholder="Selecione um item"
          />

          {selectedItem && (
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

          <Input
            label="Quantidade"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
          />

          {selectedItem && quantity && Number(quantity) > 0 && (
            <div className="rounded-lg bg-gray-800/50 p-3 text-sm text-gray-300">
              Sera adicionado{' '}
              <span className="font-medium text-orange-400">
                {formatQuantity(Number(quantity), selectedItem.unit)}
              </span>{' '}
              de {selectedItem.name}
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
              disabled={!selectedItemId || !quantity || Number(quantity) <= 0}
            >
              Adicionar ao Inventario
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
