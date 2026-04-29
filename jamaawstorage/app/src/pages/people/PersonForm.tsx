import { useState, useEffect, useCallback } from 'react'
import type { Tables, TablesInsert, TablesUpdate, AppRole } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Alert, Button, Input, Select } from '../../components/ui'

interface PersonFormProps {
  person?: Tables<'people'> | null
  onSubmit: (person: Tables<'people'>) => void
  onCancel: () => void
}

interface FormState {
  full_name: string
  employee_id: string
  role: AppRole
  sector: string
  photo_url: string
}

interface FormErrors {
  full_name?: string
  employee_id?: string
  role?: string
  form?: string
}

export function PersonForm({ person, onSubmit, onCancel }: PersonFormProps) {
  const { user, profile } = useAuth()
  const isEditing = person != null

  const [form, setForm] = useState<FormState>({
    full_name: '',
    employee_id: '',
    role: 'collaborator',
    sector: '',
    photo_url: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [employeeIdAvailable, setEmployeeIdAvailable] = useState<boolean | null>(null)
  const [checkingEmployeeId, setCheckingEmployeeId] = useState(false)

  useEffect(() => {
    if (person) {
      setTimeout(() => setForm({
        full_name: person.full_name,
        employee_id: person.employee_id ?? '',
        role: person.role,
        sector: person.sector ?? '',
        photo_url: person.photo_url ?? '',
      }), 0)
    }
  }, [person])

  const checkEmployeeIdUnique = useCallback(async (empId: string) => {
    if (!empId.trim()) {
      setEmployeeIdAvailable(null)
      return
    }
    if (isEditing && person && empId === (person.employee_id ?? '')) {
      setEmployeeIdAvailable(true)
      return
    }

    setCheckingEmployeeId(true)
    const { data, error } = await supabase
      .from('people')
      .select('id')
      .eq('employee_id', empId.trim())
      .maybeSingle<{ id: string }>()

    if (error) {
      setEmployeeIdAvailable(null)
      setErrors((prev) => ({
        ...prev,
        employee_id: 'Não foi possível validar a matrícula agora.',
      }))
      setCheckingEmployeeId(false)
      return
    }

    setEmployeeIdAvailable(data == null)
    setCheckingEmployeeId(false)
  }, [isEditing, person])

  const handleEmployeeIdBlur = () => {
    const empId = form.employee_id.trim()
    if (empId) {
      void checkEmployeeIdUnique(empId)
    }
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!form.full_name.trim()) {
      newErrors.full_name = 'Nome completo é obrigatório'
    }

    if (!form.employee_id.trim()) {
      newErrors.employee_id = 'Matrícula é obrigatória'
    } else if (employeeIdAvailable === false) {
      newErrors.employee_id = 'Esta matrícula já está em uso'
    }

    if (!form.role) {
      newErrors.role = 'Cargo é obrigatório'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    if (!user) {
      setErrors((prev) => ({ ...prev, form: 'Sua sessão expirou. Faça login novamente.' }))
      return
    }
    if (!profile) {
      setErrors((prev) => ({
        ...prev,
        form: 'Seu usuário autenticado ainda não possui perfil de supervisor disponível.',
      }))
      return
    }

    setIsSubmitting(true)
    setErrors((prev) => ({ ...prev, form: undefined }))

    try {
      if (isEditing && person) {
        const updateData: TablesUpdate<'people'> = {
          full_name: form.full_name.trim(),
          employee_id: form.employee_id.trim() || null,
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
          employee_id: form.employee_id.trim() || null,
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar pessoa'
      const lower = message.toLowerCase()
      let friendlyMessage = message

      if (lower.includes('people_created_by_fkey') || lower.includes('foreign key')) {
        friendlyMessage =
          'O usuário logado não possui um perfil válido em profiles. Refaça o login após aplicar a migration do Supabase.'
      } else if (lower.includes('permission denied')) {
        friendlyMessage =
          'Seu usuário não tem permissão para cadastrar pessoas. Verifique as policies e grants do Supabase.'
      }

      setErrors((prev) => ({ ...prev, form: friendlyMessage }))
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
      <Input
        label="Nome Completo"
        value={form.full_name}
        onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
        error={errors.full_name}
        required
        placeholder="Ex: João da Silva"
      />

      <Input
        label="Matrícula / ID"
        value={form.employee_id}
        onChange={(e) => {
          setForm((prev) => ({ ...prev, employee_id: e.target.value }))
          setEmployeeIdAvailable(null)
        }}
        onBlur={handleEmployeeIdBlur}
        error={errors.employee_id}
        helperText={
          checkingEmployeeId
            ? 'Verificando...'
            : employeeIdAvailable === true
              ? 'Matrícula disponível'
              : employeeIdAvailable === false
                ? undefined
                : undefined
        }
        required
        placeholder="Ex: EMP-001"
      />

      <Select
        label="Cargo"
        value={form.role}
        onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as AppRole }))}
        options={roleOptions}
        error={errors.role}
        required
      />

      <Input
        label="Setor / Obra Padrão"
        value={form.sector}
        onChange={(e) => setForm((prev) => ({ ...prev, sector: e.target.value }))}
        placeholder="Ex: Construção Civil, Manutenção"
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-300">Foto de Perfil</label>
        <input
          type="file"
          accept="image/*"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-orange-500 file:px-3 file:py-1 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
          onChange={() => {
            // File upload for future Supabase Storage integration
          }}
        />
        <p className="text-sm text-gray-500">Envio de foto disponível em breve</p>
      </div>

      {errors.form && (
        <Alert variant="danger">
          {errors.form}
        </Alert>
      )}

      <div className="flex justify-end gap-3 border-t border-gray-700 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {isEditing ? 'Salvar Alterações' : 'Cadastrar Pessoa'}
        </Button>
      </div>
    </form>
  )
}
