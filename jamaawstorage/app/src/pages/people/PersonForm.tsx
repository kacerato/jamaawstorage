import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { AppRole, Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { DEFAULT_IMAGE_UPLOAD_OPTIONS, imageFileToDataUrl } from '../../lib/utils'
import { Alert, Button, Input, Select } from '../../components/ui'

interface PersonFormProps {
  person?: Tables<'people'> | null
  onSubmit: (person: Tables<'people'>) => void
  onCancel: () => void
}

interface FormState {
  full_name: string
  role: AppRole
  sector: string
  photo_url: string
}

interface FormErrors {
  full_name?: string
  role?: string
  form?: string
}

function getAutoEmployeeIdLabel(role: AppRole): string {
  return role === 'leader' ? 'JMW-001' : 'JMW-001'
}

export function PersonForm({ person, onSubmit, onCancel }: PersonFormProps) {
  const { user, profile } = useAuth()
  const isEditing = person != null
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<FormState>({
    full_name: '',
    role: 'collaborator',
    sector: '',
    photo_url: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!person) return
    setForm({
      full_name: person.full_name,
      role: person.role,
      sector: person.sector ?? '',
      photo_url: person.photo_url ?? '',
    })
    setPhotoPreview(person.photo_url ?? null)
  }, [person])

  const validate = (): boolean => {
    const next: FormErrors = {}
    if (!form.full_name.trim()) next.full_name = 'Nome completo é obrigatório'
    if (!form.role) next.role = 'Cargo é obrigatório'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const updatePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const dataUrl = await imageFileToDataUrl(file, DEFAULT_IMAGE_UPLOAD_OPTIONS)
      setPhotoPreview(dataUrl)
      setForm((prev) => ({ ...prev, photo_url: dataUrl }))
    } catch (error) {
      console.error(error)
    }
  }

  const clearPhoto = () => {
    setPhotoPreview(null)
    setForm((prev) => ({ ...prev, photo_url: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    if (!user) {
      setErrors((prev) => ({ ...prev, form: 'Sua sessão expirou. Faça login novamente.' }))
      return
    }

    if (!profile) {
      setErrors((prev) => ({ ...prev, form: 'Seu perfil de supervisor não foi encontrado.' }))
      return
    }

    setIsSubmitting(true)
    setErrors((prev) => ({ ...prev, form: undefined }))

    try {
      if (isEditing && person) {
        const updateData: TablesUpdate<'people'> = {
          full_name: form.full_name.trim(),
          role: form.role,
          sector: form.sector.trim() || null,
          photo_url: form.photo_url.trim() || null,
          updated_at: new Date().toISOString(),
        }

        const { data, error } = await supabase
          .from('people')
          .update(updateData)
          .eq('id', person.id)
          .select()
          .single<Tables<'people'>>()

        if (error) throw error
        if (data) onSubmit(data)
      } else {
        const insertData: TablesInsert<'people'> = {
          full_name: form.full_name.trim(),
          role: form.role,
          sector: form.sector.trim() || null,
          photo_url: form.photo_url.trim() || null,
          is_active: true,
          created_by: profile.id,
        }

        const { data, error } = await supabase
          .from('people')
          .insert(insertData)
          .select()
          .single<Tables<'people'>>()

        if (error) throw error
        if (data) onSubmit(data)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar colaborador'
      setErrors((prev) => ({ ...prev, form: message }))
    } finally {
      setIsSubmitting(false)
    }
  }

  const roleOptions = [
    { value: 'leader', label: 'Líder' },
    { value: 'collaborator', label: 'Colaborador' },
  ]

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
          Identidade
        </p>

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex items-center gap-4">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5">
              {photoPreview ? (
                <img src={photoPreview} alt="Foto do colaborador" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="text-xl font-semibold text-orange-300">
                  {form.full_name
                    .split(' ')
                    .map((part) => part[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || 'JW'}
                </span>
              )}
              {photoPreview && (
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm text-white"
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
              <p className="text-xs text-gray-500">JPG ou PNG, até {DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={updatePhoto}
                className="hidden"
              />
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-3">
            <p className="text-sm font-medium text-gray-200">Matrícula</p>
            <p className="mt-1 text-sm text-orange-300">
              {isEditing ? person?.employee_id ?? 'Gerada automaticamente' : 'Gerada automaticamente ao salvar'}
            </p>
            <p className="mt-1 text-xs text-gray-500">Sequência padrão do sistema, ex.: {getAutoEmployeeIdLabel(form.role)}</p>
          </div>
        </div>
      </div>

      <Input
        label="Nome completo"
        value={form.full_name}
        onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
        error={errors.full_name}
        required
        placeholder="Ex: João da Silva"
      />

      <Select
        label="Cargo"
        value={form.role}
        onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as AppRole }))}
        options={roleOptions}
        error={errors.role}
        required
      />

      <Input
        label="Setor / Obra padrão"
        value={form.sector}
        onChange={(event) => setForm((prev) => ({ ...prev, sector: event.target.value }))}
        placeholder="Ex: Construção Civil, Manutenção"
      />

      {errors.form && <Alert variant="danger">{errors.form}</Alert>}

      <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {isEditing ? 'Salvar alterações' : 'Cadastrar colaborador'}
        </Button>
      </div>
    </form>
  )
}
