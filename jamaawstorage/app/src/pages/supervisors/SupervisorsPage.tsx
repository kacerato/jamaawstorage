import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Alert, Badge, Button, Card, Input, Modal, Spinner } from '../../components/ui'
import { UsersIcon } from '../../components/icons'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

type Supervisor = Tables<'profiles'>

interface FormData {
  email: string
  password: string
  full_name: string
  sector: string
}

const initialFormData: FormData = {
  email: '',
  password: '',
  full_name: '',
  sector: '',
}

const supervisorsPageCache: {
  supervisors: Supervisor[]
} = {
  supervisors: [],
}

export function SupervisorsPage() {
  const { createSupervisor } = useAuth()
  const [supervisors, setSupervisors] = useState<Supervisor[]>(supervisorsPageCache.supervisors)
  const [loading, setLoading] = useState(supervisorsPageCache.supervisors.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormData, string>>>({})
  const [creating, setCreating] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<Supervisor | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const fetchSupervisors = useCallback(async () => {
    const shouldShowFullLoading = supervisors.length === 0
    if (shouldShowFullLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'supervisor')
        .order('full_name')

      if (fetchError) {
        setError(fetchError.message)
        return
      }

      const nextSupervisors = data ?? []
      supervisorsPageCache.supervisors = nextSupervisors
      setSupervisors(nextSupervisors)
    } catch (err) {
      console.error('Error fetching supervisors:', err)
      setError('Erro ao carregar supervisores.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [supervisors.length])

  useEffect(() => {
    void fetchSupervisors()
  }, [fetchSupervisors])

  const filteredSupervisors = supervisors.filter((supervisor) =>
    supervisor.full_name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    (supervisor.employee_id ?? '').toLowerCase().includes(debouncedSearch.toLowerCase())
  )

  const validateForm = () => {
    const nextErrors: Partial<Record<keyof FormData, string>> = {}

    if (!formData.email.trim()) {
      nextErrors.email = 'E-mail é obrigatório'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      nextErrors.email = 'E-mail inválido'
    }

    if (!formData.password) {
      nextErrors.password = 'Senha é obrigatória'
    } else if (formData.password.length < 6) {
      nextErrors.password = 'Mínimo de 6 caracteres'
    }

    if (!formData.full_name.trim()) {
      nextErrors.full_name = 'Nome completo é obrigatório'
    }

    setFormErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleCreate = async () => {
    if (!validateForm()) return

    setCreating(true)
    setError(null)

    const { error: createError } = await createSupervisor({
      email: formData.email.trim(),
      password: formData.password,
      full_name: formData.full_name.trim(),
      sector: formData.sector.trim() || undefined,
    })

    if (createError) {
      setError(createError)
      setCreating(false)
      return
    }

    setSuccessMessage(`Supervisor "${formData.full_name.trim()}" criado com sucesso.`)
    setShowCreateModal(false)
    setFormData(initialFormData)
    setFormErrors({})
    setCreating(false)
    void fetchSupervisors()
    window.setTimeout(() => setSuccessMessage(null), 5000)
  }

  const handleToggleActive = async (supervisor: Supervisor) => {
    setTogglingId(supervisor.id)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        is_active: !supervisor.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', supervisor.id)

    if (updateError) {
      setError(updateError.message)
      setTogglingId(null)
      return
    }

    setSupervisors((prev) =>
      prev.map((current) =>
        current.id === supervisor.id
          ? { ...current, is_active: !current.is_active }
          : current
      )
    )
    setConfirmToggle(null)
    setTogglingId(null)
  }

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Supervisores</h2>
          <p className="mt-1 text-sm text-gray-400">
            Gerenciamento das contas supervisoras do sistema
          </p>
        </div>
        <Button
          onClick={() => {
            setFormData(initialFormData)
            setFormErrors({})
            setShowPassword(false)
            setShowCreateModal(true)
          }}
          leftIcon={<UsersIcon size={16} />}
        >
          Novo supervisor
        </Button>
      </div>

      <div className="max-w-md">
        <Input
          placeholder="Buscar por nome ou matrícula..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          leftIcon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-400">
              <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="2" />
              <path d="M11 11L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      {refreshing && (
        <div className="inline-flex items-center gap-2 text-xs text-orange-200/75">
          <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
          Atualizando supervisores...
        </div>
      )}

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success" dismissible onDismiss={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : filteredSupervisors.length === 0 ? (
        <Card variant="bordered" className="py-12 text-center">
          <UsersIcon size={48} className="mx-auto mb-4 text-gray-600" />
          <p className="text-gray-400">
            {search ? 'Nenhum supervisor encontrado para a busca.' : 'Nenhum supervisor cadastrado.'}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSupervisors.map((supervisor) => (
            <Card key={supervisor.id} variant="bordered" padding="lg">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gray-800 text-sm font-medium text-gray-300">
                      {supervisor.photo_url ? (
                        <img src={supervisor.photo_url} alt={supervisor.full_name} className="h-full w-full object-cover" />
                      ) : (
                        supervisor.full_name
                          .split(' ')
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-white">{supervisor.full_name}</p>
                      <p className="text-xs text-gray-400">Matrícula: {supervisor.employee_id ?? 'MAT-...'}</p>
                    </div>
                  </div>
                  {supervisor.is_active ? <Badge variant="success" dot>Ativo</Badge> : <Badge variant="danger" dot>Inativo</Badge>}
                </div>

                {supervisor.sector && (
                  <p className="text-sm text-gray-400">
                    <span className="text-gray-500">Setor:</span> {supervisor.sector}
                  </p>
                )}

                <div className="flex justify-end border-t border-gray-800 pt-3">
                  <Button
                    variant={supervisor.is_active ? 'secondary' : 'primary'}
                    size="sm"
                    isLoading={togglingId === supervisor.id}
                    onClick={() => setConfirmToggle(supervisor)}
                  >
                    {supervisor.is_active ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirmToggle && (
        <Modal
          isOpen={true}
          onClose={() => setConfirmToggle(null)}
          title={confirmToggle.is_active ? 'Desativar Supervisor' : 'Reativar Supervisor'}
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-300">
              Tem certeza que deseja {confirmToggle.is_active ? 'desativar' : 'reativar'}{' '}
              <span className="font-medium text-white">{confirmToggle.full_name}</span>?
            </p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setConfirmToggle(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant={confirmToggle.is_active ? 'danger' : 'primary'}
                onClick={() => void handleToggleActive(confirmToggle)}
              >
                {confirmToggle.is_active ? 'Desativar' : 'Reativar'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Novo Supervisor" size="md">
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-3">
            <p className="text-sm font-medium text-gray-200">Matrícula</p>
            <p className="mt-1 text-sm text-orange-300">Gerada automaticamente ao salvar</p>
            <p className="mt-1 text-xs text-gray-500">Sequência padrão do sistema, ex.: MAT-001</p>
          </div>

          <Input
            label="E-mail"
            type="email"
            placeholder="supervisor@empresa.com"
            value={formData.email}
            onChange={(event) => updateField('email', event.target.value)}
            error={formErrors.email}
            required
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="supervisor-password" className="text-sm font-medium text-gray-300">
              Senha <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                id="supervisor-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Mínimo 6 caracteres"
                value={formData.password}
                onChange={(event) => updateField('password', event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition-colors hover:text-white"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
            {formErrors.password && <p className="text-sm text-red-400">{formErrors.password}</p>}
          </div>

          <Input
            label="Nome completo"
            placeholder="Nome do supervisor"
            value={formData.full_name}
            onChange={(event) => updateField('full_name', event.target.value)}
            error={formErrors.full_name}
            required
          />

          <Input
            label="Setor"
            placeholder="Opcional"
            value={formData.sector}
            onChange={(event) => updateField('sector', event.target.value)}
          />

          <div className="flex justify-end gap-3 border-t border-gray-700 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="button" isLoading={creating} onClick={() => void handleCreate()}>
              Criar supervisor
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
