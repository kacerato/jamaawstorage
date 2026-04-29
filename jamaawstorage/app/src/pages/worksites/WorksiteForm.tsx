import { useState, useEffect } from 'react'
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button, Input } from '../../components/ui'

type WorkSiteRow = Tables<'work_sites'>
type WorkSiteInsert = TablesInsert<'work_sites'>

interface WorksiteFormProps {
  worksite?: WorkSiteRow | null
  onSubmit: () => void
  onCancel: () => void
}

interface FormState {
  name: string
  description: string
  location: string
  is_active: boolean
}

interface FormErrors {
  name?: string
}

export function WorksiteForm({ worksite, onSubmit, onCancel }: WorksiteFormProps) {
  const { user } = useAuth()
  const isEditing = worksite != null

  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    location: '',
    is_active: true,
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (worksite) {
      setTimeout(() => setForm({
        name: worksite.name,
        description: '',
        location: worksite.location ?? '',
        is_active: worksite.is_active,
      }), 0)
    }
  }, [worksite])

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!form.name.trim()) {
      newErrors.name = 'Nome da obra é obrigatório'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    if (!user) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      if (isEditing && worksite) {
        const updateData: TablesUpdate<'work_sites'> = {
          name: form.name.trim(),
          location: form.location.trim() || null,
          is_active: form.is_active,
          updated_at: new Date().toISOString(),
        }

        const { error } = await supabase
          .from('work_sites')
          .update(updateData)
          .eq('id', worksite.id)

        if (error) throw error
        onSubmit()
      } else {
        const insertData: WorkSiteInsert = {
          name: form.name.trim(),
          location: form.location.trim() || null,
          is_active: form.is_active,
        }

        const { error } = await supabase
          .from('work_sites')
          .insert(insertData)

        if (error) throw error
        onSubmit()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar obra'
      setSubmitError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="Nome da Obra *"
        value={form.name}
        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
        error={errors.name}
        required
        placeholder="Ex: Obra Centro Distribuição"
      />

      <Input
        label="Localização"
        value={form.location}
        onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
        placeholder="Ex: Av. Industrial, 1500 - Setor Norte"
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-300">Ativo</label>
        <button
          type="button"
          role="switch"
          aria-checked={form.is_active}
          onClick={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${
            form.is_active ? 'bg-orange-500' : 'bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              form.is_active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <p className="text-xs text-gray-500">
          {form.is_active ? 'Esta obra está ativa e disponível para retiradas' : 'Esta obra está inativa e não aparecerá nas opções de retirada'}
        </p>
      </div>

      {submitError && (
        <p className="text-sm text-red-400">{submitError}</p>
      )}

      <div className="flex justify-end gap-3 border-t border-gray-700 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {isEditing ? 'Salvar Alterações' : 'Cadastrar Obra'}
        </Button>
      </div>
    </form>
  )
}
