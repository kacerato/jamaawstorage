import { useState, type FormEvent } from 'react'
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { Input, Select, Button } from '../../components/ui'

type StockItemRow = Tables<'stock_items'>
type StockItemInsert = TablesInsert<'stock_items'>
type StockItemUpdate = TablesUpdate<'stock_items'>

interface StockItemFormData {
  name: string
  description: string
  category: string
  unit: string
  current_quantity: number
  minimum_quantity: number
  ca_nr: string
}

const UNIT_OPTIONS = [
  { value: 'un', label: 'un - Unidade' },
  { value: 'pç', label: 'pç - Peça' },
  { value: 'cx', label: 'cx - Caixa' },
  { value: 'm', label: 'm - Metro' },
  { value: 'kg', label: 'kg - Quilograma' },
  { value: 'l', label: 'l - Litro' },
  { value: 'par', label: 'par - Par' },
]

const CATEGORY_OPTIONS = [
  { value: 'EPI', label: 'EPI' },
  { value: 'Ferramenta', label: 'Ferramenta' },
  { value: 'Material', label: 'Material' },
  { value: 'Outro', label: 'Outro' },
]

const SVG_ICON_KEY_OPTIONS = [
  { value: 'helmet', label: 'Capacete' },
  { value: 'pliers', label: 'Alicate' },
  { value: 'gloves', label: 'Luvas' },
  { value: 'goggles', label: 'Óculos' },
  { value: 'vest', label: 'Colete' },
  { value: 'package', label: 'Pacote' },
]

interface FormErrors {
  name?: string
  current_quantity?: string
  minimum_quantity?: string
}

interface StockItemFormProps {
  item: StockItemRow | null
  onSubmit: (data: StockItemInsert | StockItemUpdate) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
}

function itemToFormData(item: StockItemRow | null): StockItemFormData {
  if (!item) {
    return {
      name: '',
      description: '',
      category: '',
      unit: 'un',
      current_quantity: 0,
      minimum_quantity: 0,
      ca_nr: '',
    }
  }
  return {
    name: item.name,
    description: item.description ?? '',
    category: item.category ?? '',
    unit: item.unit,
    current_quantity: item.current_quantity,
    minimum_quantity: item.minimum_quantity,
    ca_nr: item.ca_nr ?? '',
  }
}

export function StockItemForm({
  item,
  onSubmit,
  onCancel,
  isSubmitting,
}: StockItemFormProps) {
  const isEditing = item !== null
  const [formData, setFormData] = useState<StockItemFormData>(
    itemToFormData(item)
  )
  const [svgIconKey, setSvgIconKey] = useState<string>(
    isEditing ? 'package' : 'package'
  )
  const [errors, setErrors] = useState<FormErrors>({})

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Nome é obrigatório'
    }

    if (formData.current_quantity < 0) {
      newErrors.current_quantity = 'Quantidade deve ser maior ou igual a zero'
    }

    if (formData.minimum_quantity < 0) {
      newErrors.minimum_quantity =
        'Quantidade mínima deve ser maior ou igual a zero'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!validate()) return

    const baseData = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      category: formData.category || null,
      unit: formData.unit,
      current_quantity: formData.current_quantity,
      minimum_quantity: formData.minimum_quantity,
      ca_nr: formData.ca_nr.trim() || null,
      svg_icon_key: svgIconKey,
    }

    if (isEditing) {
      const updateData: StockItemUpdate = {
        ...baseData,
        updated_at: new Date().toISOString(),
      }
      await onSubmit(updateData)
    } else {
      const insertData: StockItemInsert = {
        ...baseData,
      }
      await onSubmit(insertData)
    }
  }

  const handleChange = (
    field: keyof StockItemFormData,
    value: string | number
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field as keyof FormErrors]
        return next
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nome *"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          error={errors.name}
          placeholder="Nome do item"
          required
        />

        <Select
          label="Unidade"
          value={formData.unit}
          onChange={(e) => handleChange('unit', e.target.value)}
          options={UNIT_OPTIONS}
        />
      </div>

      <Input
        label="Descrição"
        value={formData.description}
        onChange={(e) => handleChange('description', e.target.value)}
        placeholder="Descrição do item (opcional)"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Categoria"
          value={formData.category}
          onChange={(e) => handleChange('category', e.target.value)}
          options={CATEGORY_OPTIONS}
          placeholder="Selecione uma categoria"
        />

        <Select
          label="Ícone SVG"
          value={svgIconKey}
          onChange={(e) => setSvgIconKey(e.target.value)}
          options={SVG_ICON_KEY_OPTIONS}
        />
      </div>

      <Input
        label="CA/NR"
        value={formData.ca_nr ?? ''}
        onChange={(e) => handleChange('ca_nr', e.target.value)}
        placeholder="Certificado de Aprovação - apenas para EPIs"
        helperText="Certificado de Aprovação - apenas para EPIs"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Quantidade Atual"
          type="number"
          min={0}
          value={String(formData.current_quantity)}
          onChange={(e) =>
            handleChange('current_quantity', parseInt(e.target.value, 10) || 0)
          }
          error={errors.current_quantity}
        />

        <Input
          label="Quantidade Mínima"
          type="number"
          min={0}
          value={String(formData.minimum_quantity)}
          onChange={(e) =>
            handleChange('minimum_quantity', parseInt(e.target.value, 10) || 0)
          }
          error={errors.minimum_quantity}
        />
      </div>



      <div className="flex items-center justify-end gap-3 border-t border-gray-700 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          {isEditing ? 'Salvar Alterações' : 'Criar Item'}
        </Button>
      </div>
    </form>
  )
}
