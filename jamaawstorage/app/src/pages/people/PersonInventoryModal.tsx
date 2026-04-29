import { useState, useEffect, useCallback } from 'react'

import { supabase } from '../../lib/supabase'
import { formatQuantity } from '../../lib/utils'
import { Button, Input, Select, Alert } from '../../components/ui'

interface PersonInventoryModalProps {
  isOpen: boolean
  onClose: () => void
  personId: string
  personName: string
  onAdded: () => void
}

interface StockItemOption {
  id: string
  name: string
  unit: string
  quantity: number
  minimum_quantity: number
}

interface ExistingInventoryItem {
  stock_item_id: string
}

export function PersonInventoryModal({
  isOpen,
  onClose,
  personId,
  personName,
  onAdded,
}: PersonInventoryModalProps) {
  const [stockItems, setStockItems] = useState<StockItemOption[]>([])
  const [existingItems, setExistingItems] = useState<ExistingInventoryItem[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [quantity, setQuantity] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const fetchStockItems = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [stockRes, existingRes] = await Promise.all([
      supabase
        .from('stock_items')
        .select('id, name, unit, quantity, minimum_quantity')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('person_inventories')
        .select('stock_item_id')
        .eq('person_id', personId),
    ])

    if (stockRes.error) {
      setError(stockRes.error.message)
      setLoading(false)
      return
    }
    if (existingRes.error) {
      setError(existingRes.error.message)
      setLoading(false)
      return
    }

    setStockItems((stockRes.data ?? []) as unknown as StockItemOption[])
    setExistingItems((existingRes.data ?? []) as ExistingInventoryItem[])
    setLoading(false)
  }, [personId])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        void fetchStockItems()
        setSelectedItemId('')
        setQuantity('')
        setError(null)
        setSuccess(false)
      }, 0)
    }
  }, [isOpen, fetchStockItems])

  const availableItems = stockItems.filter(
    (item) => !existingItems.some((ex) => ex.stock_item_id === item.id),
  )

  const selectedItem = stockItems.find((item) => item.id === selectedItemId)

  const handleSubmit = async () => {
    if (!selectedItemId || !quantity || Number(quantity) <= 0) return

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('person_inventories').insert({
      person_id: personId,
      stock_item_id: selectedItemId,
      quantity: Number(quantity),
    })

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setSuccess(true)
    setSubmitting(false)
    onAdded()

    setTimeout(() => {
      onClose()
    }, 1000)
  }

  if (!isOpen) return null

  const stockOptions = availableItems.map((item) => ({
    value: item.id,
    label: `${item.name} (${item.unit})`,
  }))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-400">
        Adicionar item ao inventário de <span className="font-medium text-white">{personName}</span>
      </p>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert variant="success">Item adicionado ao inventário com sucesso!</Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        </div>
      ) : availableItems.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-4">
          Todos os itens ativos já estão no inventário desta pessoa.
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
                <span>Estoque atual: {selectedItem.quantity}</span>
                <span>Mínimo: {selectedItem.minimum_quantity}</span>
                {selectedItem.quantity <= selectedItem.minimum_quantity && (
                  <span className="text-amber-400 font-medium">Estoque baixo!</span>
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
              Será adicionado:{' '}
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
              Adicionar ao Inventário
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
