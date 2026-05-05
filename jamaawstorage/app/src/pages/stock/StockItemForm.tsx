import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { DEFAULT_IMAGE_UPLOAD_OPTIONS, imageFileToDataUrl } from '../../lib/utils'
import { Alert, Button, Input, Modal, Select } from '../../components/ui'
import { ItemVisual, itemLabelForKey, normalizeItemIconKey } from '../../components/items/ItemVisual'

type StockItemRow = Tables<'stock_items'>
type StockItemInsert = TablesInsert<'stock_items'>
type StockItemUpdate = TablesUpdate<'stock_items'>

interface StockItemFormData {
  code: string
  name: string
  description: string
  category: string
  unit: string
  current_quantity: number
  stock_adjustment: number
  minimum_quantity: number
  ca_nr: string
}

interface FormErrors {
  name?: string
  current_quantity?: string
  minimum_quantity?: string
}

interface StockItemFormProps {
  item: StockItemRow | null
  onSubmit: (data: (StockItemInsert | StockItemUpdate) & { stock_adjustment?: number }) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
}

const UNIT_OPTIONS = [
  { value: 'un', label: 'un - Unidade' },
  { value: 'kit', label: 'kit - Kit' },
  { value: 'pc', label: 'pc - Peca' },
  { value: 'cx', label: 'cx - Caixa' },
  { value: 'm', label: 'm - Metro' },
  { value: 'kg', label: 'kg - Quilograma' },
  { value: 'l', label: 'l - Litro' },
  { value: 'par', label: 'par - Par' },
]

const CATEGORY_OPTIONS = [
  { value: 'EPI', label: 'EPI' },
  { value: 'Vestuario', label: 'Vestuario' },
  { value: 'Ferramenta', label: 'Ferramenta' },
  { value: 'Material', label: 'Material' },
  { value: 'Outro', label: 'Outro' },
]

const ICON_OPTIONS = [
  { value: 'capacete', label: 'Capacete' },
  { value: 'alicate', label: 'Alicate' },
  { value: 'oculos', label: 'Oculos' },
  { value: 'luvas', label: 'Luvas' },
  { value: 'chavecatraca', label: 'Chave catraca' },
  { value: 'balaclava', label: 'Balaclava' },
  { value: 'material', label: 'Material' },
  { value: 'fardamento', label: 'Fardamento' },
  { value: 'bolsa', label: 'Bolsa' },
  { value: 'bota', label: 'Bota' },
  { value: 'cinto', label: 'Cinto' },
  { value: 'talabarte', label: 'Talabarte' },
  { value: 'martelo', label: 'Martelo' },
]

const ICON_SAMPLE_COUNT = 6
const ICON_SAMPLE_OPTIONS = ICON_OPTIONS.slice(0, ICON_SAMPLE_COUNT)

function initFormData(item: StockItemRow | null): StockItemFormData {
  if (!item) {
    return {
      code: '',
      name: '',
      description: '',
      category: '',
      unit: 'un',
      current_quantity: 0,
      stock_adjustment: 0,
      minimum_quantity: 0,
      ca_nr: '',
    }
  }

  return {
    code: item.code,
    name: item.name,
    description: item.description ?? '',
    category: item.category ?? '',
    unit: item.unit,
    current_quantity: item.current_quantity,
    stock_adjustment: 0,
    minimum_quantity: item.minimum_quantity,
    ca_nr: item.ca_nr ?? '',
  }
}

function sanitizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24)
}

export function StockItemForm({ item, onSubmit, onCancel, isSubmitting }: StockItemFormProps) {
  const isEditing = item !== null
  const [formData, setFormData] = useState<StockItemFormData>(initFormData(item))
  const [svgIconKey, setSvgIconKey] = useState<string>(
    normalizeItemIconKey(item?.svg_icon_key) ?? 'capacete'
  )
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    item?.svg_icon_key?.startsWith('data:image/') ? item.svg_icon_key : null
  )
  const [adjustmentMode, setAdjustmentMode] = useState<'add' | 'remove'>('add')
  const [showIconLibrary, setShowIconLibrary] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validate = (): boolean => {
    const next: FormErrors = {}
    if (!formData.name.trim()) next.name = 'Nome e obrigatorio'
    if (formData.current_quantity < 0) next.current_quantity = 'Deve ser maior ou igual a 0'
    if (formData.minimum_quantity < 0) next.minimum_quantity = 'Deve ser maior ou igual a 0'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleChange = (field: keyof StockItemFormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field as keyof FormErrors]
        return next
      })
    }
  }

  const handlePhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setUploadError(null)
      const dataUrl = await imageFileToDataUrl(file, DEFAULT_IMAGE_UPLOAD_OPTIONS)
      setPhotoPreview(dataUrl)
      setSvgIconKey(dataUrl)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Nao foi possivel enviar a foto.')
    }
  }

  const clearPhoto = () => {
    setPhotoPreview(null)
    setSvgIconKey('capacete')
    setUploadError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSelectIcon = (iconKey: string) => {
    setPhotoPreview(null)
    setUploadError(null)
    setSvgIconKey(iconKey)
    setShowIconLibrary(false)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    const absoluteAdjustment = Math.abs(formData.stock_adjustment)
    const signedAdjustment = isEditing
      ? adjustmentMode === 'remove'
        ? -absoluteAdjustment
        : absoluteAdjustment
      : undefined

    const basePayload = {
      code: isEditing ? sanitizeCode(formData.code) : '',
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      category: formData.category || null,
      unit: formData.unit,
      minimum_quantity: formData.minimum_quantity,
      ca_nr: formData.ca_nr.trim() || null,
      svg_icon_key: svgIconKey,
    }

    if (isEditing) {
      await onSubmit({
        ...basePayload,
        stock_adjustment: signedAdjustment,
        updated_at: new Date().toISOString(),
      } as StockItemUpdate & { stock_adjustment?: number })
      return
    }

    await onSubmit({
      ...basePayload,
      current_quantity: formData.current_quantity,
    } as StockItemInsert)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {uploadError && <Alert variant="danger">{uploadError}</Alert>}

      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
          Identidade do item
        </p>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <ItemVisual iconKey={photoPreview ?? svgIconKey} size={72} />
              {photoPreview && (
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm text-white"
                  title="Remover foto"
                >
                  x
                </button>
              )}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-500/16"
              >
                Enviar foto
              </button>
              <p className="text-xs text-gray-500">JPG ou PNG, ate {DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-[#0e0f12] p-3">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              Biblioteca de icones
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {ICON_SAMPLE_OPTIONS.map((option) => {
                const active = !photoPreview && svgIconKey === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelectIcon(option.value)}
                    className={`group flex min-h-[108px] w-full min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-center transition-all ${
                      active
                        ? 'border-orange-400/40 bg-orange-500/16 shadow-[0_0_0_1px_rgba(249,115,22,0.08)]'
                        : 'border-white/8 bg-white/4 hover:border-white/14 hover:bg-white/8'
                    }`}
                    title={option.label}
                  >
                    <ItemVisual iconKey={option.value} size={42} />
                    <span
                      className={`line-clamp-2 min-h-[30px] max-w-full text-[11px] font-medium leading-4 ${
                        active ? 'text-orange-100' : 'text-gray-400 group-hover:text-gray-200'
                      }`}
                    >
                      {option.label}
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setShowIconLibrary(true)}
                className="group flex min-h-[108px] w-full min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/12 bg-white/4 px-3 py-3 text-center transition-all hover:border-orange-400/25 hover:bg-white/8"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-xl text-orange-200">
                  +
                </span>
                <span className="text-[11px] font-medium leading-4 text-gray-300 group-hover:text-white">
                  + icones
                </span>
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Icone atual: <span className="text-orange-200/80">{itemLabelForKey(photoPreview ?? svgIconKey)}</span>
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
          Dados principais
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Nome *"
            value={formData.name}
            onChange={(event) => handleChange('name', event.target.value)}
            error={errors.name}
            placeholder="Ex: Capacete de seguranca"
            required
          />

          {isEditing ? (
            <Input
              label="Codigo"
              value={formData.code}
              onChange={(event) => handleChange('code', sanitizeCode(event.target.value))}
              helperText="Mantido pelo sistema"
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-3">
              <p className="text-sm font-medium text-gray-200">Codigo</p>
              <p className="mt-1 text-sm text-orange-300">Gerado automaticamente ao salvar</p>
              <p className="mt-1 text-xs text-gray-500">Exemplo: CPT-001</p>
            </div>
          )}
        </div>

        <div className="mt-3">
          <Input
            label="Descricao"
            value={formData.description}
            onChange={(event) => handleChange('description', event.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
          Classificacao
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Categoria"
            value={formData.category}
            onChange={(event) => handleChange('category', event.target.value)}
            options={CATEGORY_OPTIONS}
            placeholder="Selecione"
          />
          <Select
            label="Unidade"
            value={formData.unit}
            onChange={(event) => handleChange('unit', event.target.value)}
            options={UNIT_OPTIONS}
          />
          <Input
            label="CA / NR"
            value={formData.ca_nr}
            onChange={(event) => handleChange('ca_nr', event.target.value)}
            placeholder="Somente EPIs"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
          Estoque
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isEditing ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-3">
              <p className="text-sm font-medium text-gray-200">Quantidade atual</p>
              <p className="mt-1 text-sm text-orange-300">{formData.current_quantity} {formData.unit}</p>
              <p className="mt-1 text-xs text-gray-500">Entradas e correcoes usam ajuste aditivo para evitar conflito entre supervisores.</p>
            </div>
          ) : (
            <Input
              label="Quantidade inicial"
              type="number"
              min={0}
              value={String(formData.current_quantity)}
              onChange={(event) => handleChange('current_quantity', parseInt(event.target.value, 10) || 0)}
              error={errors.current_quantity}
            />
          )}
          {isEditing && (
            <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <p className="text-sm font-medium text-gray-200">Ajuste de estoque</p>
                <div className="grid w-full max-w-[220px] grid-cols-2 rounded-xl border border-white/8 bg-[#0f1013] p-1 sm:justify-self-end">
                  <button
                    type="button"
                    onClick={() => setAdjustmentMode('add')}
                    className={`flex min-h-[34px] items-center justify-center rounded-lg px-3 py-1.5 text-center text-xs font-medium transition-colors ${
                      adjustmentMode === 'add'
                        ? 'bg-emerald-500/18 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.16)]'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Entrada
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustmentMode('remove')}
                    className={`flex min-h-[34px] items-center justify-center rounded-lg px-3 py-1.5 text-center text-xs font-medium transition-colors ${
                      adjustmentMode === 'remove'
                        ? 'bg-red-500/18 text-red-300 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.16)]'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Saida
                  </button>
                </div>
              </div>

              <Input
                label="Quantidade do ajuste"
                type="number"
                min={0}
                value={String(Math.abs(formData.stock_adjustment))}
                onChange={(event) => handleChange('stock_adjustment', parseInt(event.target.value, 10) || 0)}
                helperText={
                  adjustmentMode === 'add'
                    ? 'Use para entrada de estoque.'
                    : 'Use para diminuir o estoque.'
                }
              />
            </div>
          )}
          <Input
            label="Quantidade minima"
            type="number"
            min={0}
            value={String(formData.minimum_quantity)}
            onChange={(event) => handleChange('minimum_quantity', parseInt(event.target.value, 10) || 0)}
            error={errors.minimum_quantity}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-white/8 pt-3">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          {isEditing ? 'Salvar' : 'Criar item'}
        </Button>
      </div>

      <Modal
        isOpen={showIconLibrary}
        onClose={() => setShowIconLibrary(false)}
        title="Biblioteca de icones"
        size="lg"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {ICON_OPTIONS.map((option) => {
            const active = !photoPreview && svgIconKey === option.value

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelectIcon(option.value)}
                className={`group flex min-h-[108px] w-full min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-center transition-all ${
                  active
                    ? 'border-orange-400/40 bg-orange-500/16 shadow-[0_0_0_1px_rgba(249,115,22,0.08)]'
                    : 'border-white/8 bg-white/4 hover:border-white/14 hover:bg-white/8'
                }`}
                title={option.label}
              >
                <ItemVisual iconKey={option.value} size={42} />
                <span
                  className={`line-clamp-2 min-h-[30px] max-w-full text-[11px] font-medium leading-4 ${
                    active ? 'text-orange-100' : 'text-gray-400 group-hover:text-gray-200'
                  }`}
                >
                  {option.label}
                </span>
              </button>
            )
          })}
        </div>
      </Modal>
    </form>
  )
}
