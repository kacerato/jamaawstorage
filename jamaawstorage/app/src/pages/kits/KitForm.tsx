import { useState, type FormEvent } from 'react'
import type { Tables } from '../../types/database'
import type { KitWithItems } from '../../types'
import { Input, Button, Modal } from '../../components/ui'
import { KitItemSelector } from './KitItemSelector'
import { PackageIcon } from '../../components/icons'
import { formatQuantity } from '../../lib/utils'

type StockItemRow = Tables<'stock_items'>

export interface KitFormItem {
  stockItem: StockItemRow
  quantity: number
}

interface KitFormProps {
  kit: KitWithItems | null
  onSubmit: (data: { name: string; description: string | null; items: KitFormItem[] }) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
}

interface FormErrors {
  name?: string
  items?: string
}

function kitToFormItems(kit: KitWithItems | null): KitFormItem[] {
  if (!kit) return []
  return (kit.kit_items ?? []).map((ki) => ({
    stockItem: ki.stock_items,
    quantity: ki.quantity,
  }))
}

export function KitForm({ kit, onSubmit, onCancel, isSubmitting }: KitFormProps) {
  const isEditing = kit !== null
  const [name, setName] = useState(kit?.name ?? '')
  const [description, setDescription] = useState(kit?.description ?? '')
  const [items, setItems] = useState<KitFormItem[]>(kitToFormItems(kit))
  const [errors, setErrors] = useState<FormErrors>({})
  const [showItemSelector, setShowItemSelector] = useState(false)

  const selectedIds = new Set(items.map((i) => i.stockItem.id))

  const handleAddItem = (stockItem: StockItemRow) => {
    setItems((prev) => [...prev, { stockItem, quantity: 1 }])
    if (errors.items) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next.items
        return next
      })
    }
  }

  const handleRemoveItem = (stockItemId: string) => {
    setItems((prev) => prev.filter((i) => i.stockItem.id !== stockItemId))
  }

  const handleQuantityChange = (stockItemId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.stockItem.id === stockItemId ? { ...i, quantity: Math.max(1, quantity) } : i
      )
    )
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!name.trim()) {
      newErrors.name = 'Nome do kit é obrigatório'
    }

    if (items.length === 0) {
      newErrors.items = 'Adicione pelo menos um item ao kit'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    await onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      items,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="Nome do Kit *"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          if (errors.name) {
            setErrors((prev) => {
              const next = { ...prev }
              delete next.name
              return next
            })
          }
        }}
        error={errors.name}
        placeholder="Ex: Kit EPI Básico"
        required
      />

      <Input
        label="Descrição"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descrição do kit (opcional)"
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-300">
            Itens do Kit
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowItemSelector(true)}
            leftIcon={<PackageIcon size={14} />}
          >
            Adicionar Item
          </Button>
        </div>

        {errors.items && (
          <p className="text-sm text-red-400">{errors.items}</p>
        )}

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/4 py-8">
            <PackageIcon size={32} className="mb-2 text-gray-600" />
            <p className="text-sm text-gray-500">
              Nenhum item adicionado. Clique em &quot;Adicionar Item&quot;.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-white/3 p-3">
            {items.map((item) => (
              <div
                key={item.stockItem.id}
                className="flex items-center gap-3 rounded-2xl border border-white/6 bg-[#111217] px-3 py-2.5"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-orange-400/12 bg-orange-500/12">
                  <PackageIcon size={14} className="text-orange-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {item.stockItem.name}
                  </p>
                  <div className="flex items-center gap-2">
                    {item.stockItem.category && (
                      <span className="text-xs text-gray-500">
                        {item.stockItem.category}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      Estoque: {formatQuantity(item.stockItem.current_quantity, item.stockItem.unit)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      handleQuantityChange(
                        item.stockItem.id,
                        parseInt(e.target.value, 10) || 1
                      )
                    }
                    className="w-16 rounded-xl border border-white/10 bg-[#0d0d10] px-2 py-1.5 text-center text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                  />
                  <span className="text-xs text-gray-400">
                    {item.stockItem.unit}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.stockItem.id)}
                  className="flex-shrink-0 rounded-xl p-1.5 text-gray-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
                  aria-label={`Remover ${item.stockItem.name}`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4 4L12 12M12 4L4 12"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-white/8 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          {isEditing ? 'Salvar Alterações' : 'Criar Kit'}
        </Button>
      </div>

      <Modal
        isOpen={showItemSelector}
        onClose={() => setShowItemSelector(false)}
        title="Adicionar Item ao Kit"
        size="lg"
      >
        <KitItemSelector
          onSelect={(stockItem) => {
            handleAddItem(stockItem)
            setShowItemSelector(false)
          }}
          selectedIds={selectedIds}
        />
      </Modal>
    </form>
  )
}
