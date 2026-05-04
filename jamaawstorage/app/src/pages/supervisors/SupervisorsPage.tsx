import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { Alert, Badge, Button, Card, Input, Modal, Spinner } from '../../components/ui'
import { UsersIcon } from '../../components/icons'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

type Supervisor = Tables<'profiles'>

const supervisorsPageCache: {
  supervisors: Supervisor[]
} = {
  supervisors: [],
}

export function SupervisorsPage() {
  const [supervisors, setSupervisors] = useState<Supervisor[]>(supervisorsPageCache.supervisors)
  const [loading, setLoading] = useState(supervisorsPageCache.supervisors.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)
  const [confirmToggle, setConfirmToggle] = useState<Supervisor | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Supervisores</h2>
          <p className="mt-1 text-sm text-gray-400">
            Gerenciamento das contas supervisoras do sistema
          </p>
        </div>
      </div>

      <Alert variant="info" title="Criacao por SQL">
        Novas contas de supervisor estao desativadas no app por enquanto. Para criar supervisor, use o SQL do projeto diretamente no Supabase.
      </Alert>

      <Card variant="bordered" className="border-dashed border-white/10 bg-white/[0.03]">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-500/10 text-orange-300">
            <UsersIcon size={20} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-white">Fluxo temporario</p>
            <p className="text-sm text-gray-400">
              A listagem e a ativacao continuam funcionando aqui. A criacao ficou fora do app ate o endpoint ser refeito com seguranca.
            </p>
          </div>
        </div>
      </Card>

      <div className="max-w-md">
        <Input
          placeholder="Buscar por nome ou matricula..."
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
                      <p className="text-xs text-gray-400">Matricula: {supervisor.employee_id ?? 'MAT-...'}</p>
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
    </div>
  )
}
