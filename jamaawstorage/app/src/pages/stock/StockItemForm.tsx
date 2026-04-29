import { useState, useRef, type FormEvent, type ChangeEvent } from 'react'
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { Input, Select, Button } from '../../components/ui'
import { PackageIcon } from '../../components/icons'
import alicateImg from '../../assets/alicate.png'
import capceteImg from '../../assets/capcete.png'
import materialImg from '../../assets/material.png'
import fardamentoImg from '../../assets/fardamento.png'

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
  minimum_quantity: number
  ca_nr: string
}

interface FormErrors {
  code?: string
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

const UNIT_OPTIONS = [
  { value: 'un', label: 'un — Unidade' },
  { value: 'pç', label: 'pç — Peça' },
  { value: 'cx', label: 'cx — Caixa' },
  { value: 'm', label: 'm — Metro' },
  { value: 'kg', label: 'kg — Quilograma' },
  { value: 'l', label: 'l — Litro' },
  { value: 'par', label: 'par — Par' },
] satisfies { value: string; label: string }[]

const CATEGORY_OPTIONS = [
  { value: 'EPI', label: 'EPI' },
  { value: 'Ferramenta', label: 'Ferramenta' },
  { value: 'Material', label: 'Material' },
  { value: 'Outro', label: 'Outro' },
] satisfies { value: string; label: string }[]

type IconKey = 'capacete' | 'alicate' | 'material' | 'fardamento' | 'generico'

interface IconOption {
  value: IconKey
  label: string
  img: string | null
}

const ICON_OPTIONS: IconOption[] = [
  { value: 'capacete', label: 'Capacete', img: capceteImg },
  { value: 'alicate', label: 'Alicate', img: alicateImg },
  { value: 'material', label: 'Material', img: materialImg },
  { value: 'fardamento', label: 'Fardamento', img: fardamentoImg },
  { value: 'generico', label: 'Genérico', img: null },
]

function IconForKey({ iconKey, size = 40 }: { iconKey: IconKey; size?: number }) {
  const opt = ICON_OPTIONS.find((o) => o.value === iconKey)
  if (opt?.img) {
    return (
      <img
        src={opt.img}
        alt={opt.label}
        style={{ width: size, height: size, objectFit: 'contain' }}
        className="pointer-events-none"
        draggable={false}
      />
    )
  }
  return <PackageIcon size={Math.round(size * 0.45)} />
}

function mapLegacyKey(key: string | null | undefined): string {
  if (!key) return 'generico'
  if (key.startsWith('data:image/')) return key
  const legacyMap: Record<string, string> = {
    helmet: 'capacete',
    pliers: 'alicate',
    gloves: 'generico',
    goggles: 'generico',
    vest: 'fardamento',
    package: 'generico',
  }
  return legacyMap[key] ?? key
}

function initFormData(item: StockItemRow | null): StockItemFormData {
  if (!item) {
    return {
      code: '', name: '', description: '', category: '',
      unit: 'un', current_quantity: 0, minimum_quantity: 0, ca_nr: '',
    }
  }
  return {
    code: item.code,
    name: item.name,
    description: item.description ?? '',
    category: item.category ?? '',
    unit: item.unit,
    current_quantity: item.current_quantity,
    minimum_quantity: item.minimum_quantity,
    ca_nr: item.ca_nr ?? '',
  }
}

function sanitizeCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 24)
}

function suggestCode(v: string): string {
  return sanitizeCode(v.trim().replace(/\s+/g, '-'))
}

export function StockItemForm({ item, onSubmit, onCancel, isSubmitting }: StockItemFormProps) {
  const isEditing = item !== null
  const [formData, setFormData] = useState<StockItemFormData>(initFormData(item))
  const rawIconKey = mapLegacyKey(item?.svg_icon_key)
  const [svgIconKey, setSvgIconKey] = useState<string>(
    rawIconKey.startsWith('data:image/') ? rawIconKey : rawIconKey
  )
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    item?.svg_icon_key?.startsWith('data:image/') ? item.svg_icon_key : null
  )
  const [errors, setErrors] = useState<FormErrors>({})
  const [codeManual, setCodeManual] = useState(isEditing)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 500 * 1024) return

    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 200
      let w = img.width
      let h = img.height
      if (w > MAX || h > MAX) {
        const ratio = Math.min(MAX / w, MAX / h)
        w = Math.round(w * ratio)
        h = Math.round(h * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); return }
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      setPhotoPreview(dataUrl)
      setSvgIconKey(dataUrl)
    }
    img.onerror = () => { URL.revokeObjectURL(url) }
    img.src = url
  }

  const clearPhoto = () => {
    setPhotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const validate = (): boolean => {
    const next: FormErrors = {}
    if (!formData.code.trim()) next.code = 'Código é obrigatório'
    if (!formData.name.trim()) next.name = 'Nome é obrigatório'
    if (formData.current_quantity < 0) next.current_quantity = 'Deve ser ≥ 0'
    if (formData.minimum_quantity < 0) next.minimum_quantity = 'Deve ser ≥ 0'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleChange = (field: keyof StockItemFormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => { const n = { ...prev }; delete n[field as keyof FormErrors]; return n })
    }
  }

  const handleNameChange = (v: string) => {
    setFormData((prev) => ({
      ...prev,
      name: v,
      code: !isEditing && !codeManual && !prev.code.trim() ? suggestCode(v) : prev.code,
    }))
    if (errors.name) setErrors((prev) => { const n = { ...prev }; delete n.name; return n })
  }

  const handleCodeChange = (v: string) => {
    setCodeManual(true)
    handleChange('code', sanitizeCode(v))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    const base = {
      code: sanitizeCode(formData.code),
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      category: formData.category || null,
      unit: formData.unit,
      current_quantity: formData.current_quantity,
      minimum_quantity: formData.minimum_quantity,
      ca_nr: formData.ca_nr.trim() || null,
      svg_icon_key: svgIconKey,
    }

    try {
      if (isEditing) {
        await onSubmit({ ...base, updated_at: new Date().toISOString() } as StockItemUpdate)
      } else {
        await onSubmit(base as StockItemInsert)
      }
    } catch (err: unknown) {
      console.error('[StockItemForm] Erro no submit:', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">

      {/* ── Seção: Foto do Item ── */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-4 shadow-sm shadow-orange-500/5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-400/70" style={{ fontFamily: "'Outfit', sans-serif" }}>
          Foto do Item
        </p>

        <div className="flex items-start gap-4">
          <div className="relative flex-shrink-0">
            {photoPreview ? (
              <div className="group relative">
                <img
                  src={photoPreview}
                  alt="Foto do item"
                  className="h-16 w-16 rounded-lg border border-orange-500/30 object-cover shadow-sm shadow-orange-500/10"
                />
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                  title="Remover foto"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-gray-600 bg-gray-800/40 text-gray-500 transition-colors hover:border-orange-500/40 hover:bg-orange-500/5 hover:text-orange-400"
                title="Enviar foto"
              >
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                <span style={{ fontSize: 8, letterSpacing: '.5px' }}>UPLOAD</span>
                <span style={{ fontSize: 6, color: 'rgba(255,255,255,0.25)' }}>máx 500KB</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              className="hidden"
            />
          </div>

          <div className="flex items-center self-center">
            <span className="text-xs text-gray-600">ou</span>
          </div>

          <div className="flex flex-1 flex-wrap gap-2">
            {ICON_OPTIONS.map((opt) => {
              const isActive = svgIconKey === opt.value && !photoPreview
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setSvgIconKey(opt.value); clearPhoto() }}
                  title={opt.label}
                  className={`flex h-12 w-12 items-center justify-center rounded-lg border transition-all ${
                    isActive
                      ? 'border-orange-500/50 bg-orange-500/15 shadow-sm shadow-orange-500/15 ring-1 ring-orange-500/20'
                      : 'border-gray-700/60 bg-gray-800/30 hover:border-gray-600 hover:bg-gray-800/60'
                  }`}
                >
                  <IconForKey iconKey={opt.value} size={32} />
                </button>
              )
            })}
          </div>
        </div>

        {!photoPreview && (
          <p className="mt-2 text-xs text-gray-500">
            Selecionado: <span className="text-orange-400/80">{ICON_OPTIONS.find((o) => o.value === svgIconKey)?.label ?? svgIconKey}</span>
          </p>
        )}
      </div>

      {/* ── Seção: Identificação ── */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-4 shadow-sm shadow-orange-500/5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-400/70" style={{ fontFamily: "'Outfit', sans-serif" }}>
          Identificação
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Nome *"
            value={formData.name}
            onChange={(e) => handleNameChange(e.target.value)}
            error={errors.name}
            placeholder="Ex: Capacete de Segurança"
            required
          />
          <Input
            label="Código *"
            value={formData.code}
            onChange={(e) => handleCodeChange(e.target.value)}
            error={errors.code}
            placeholder="Ex: CAPACETE-001"
            helperText={!isEditing ? 'Auto-gerado pelo nome' : undefined}
            required
          />
        </div>
        <div className="mt-3">
          <Input
            label="Descrição"
            value={formData.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      {/* ── Seção: Classificação ── */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-4 shadow-sm shadow-orange-500/5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-400/70" style={{ fontFamily: "'Outfit', sans-serif" }}>
          Classificação
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Categoria"
            value={formData.category}
            onChange={(e) => handleChange('category', e.target.value)}
            options={CATEGORY_OPTIONS}
            placeholder="Selecione"
          />
          <Select
            label="Unidade"
            value={formData.unit}
            onChange={(e) => handleChange('unit', e.target.value)}
            options={UNIT_OPTIONS}
          />
          <Input
            label="CA / NR"
            value={formData.ca_nr}
            onChange={(e) => handleChange('ca_nr', e.target.value)}
            placeholder="Somente EPIs"
          />
        </div>
      </div>

      {/* ── Seção: Estoque ── */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-4 shadow-sm shadow-orange-500/5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-400/70" style={{ fontFamily: "'Outfit', sans-serif" }}>
          Estoque
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Qtd. Atual"
            type="number"
            min={0}
            value={String(formData.current_quantity)}
            onChange={(e) => handleChange('current_quantity', parseInt(e.target.value, 10) || 0)}
            error={errors.current_quantity}
          />
          <Input
            label="Qtd. Mínima"
            type="number"
            min={0}
            value={String(formData.minimum_quantity)}
            onChange={(e) => handleChange('minimum_quantity', parseInt(e.target.value, 10) || 0)}
            error={errors.minimum_quantity}
          />
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-700/50 pt-3">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" isLoading={isSubmitting}>
          {isEditing ? 'Salvar' : 'Criar Item'}
        </Button>
      </div>
    </form>
  )
}
