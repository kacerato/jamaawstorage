import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, Input, Modal, Spinner } from '../../components/ui'
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
    if (supervisor.is_active) {
      setConfirmToggle(null)
      return
    }

    setTogglingId(supervisor.id)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        is_active: true,
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
          ? { ...current, is_active: true }
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
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
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

                {!supervisor.is_active && (
                  <div className="flex justify-end border-t border-gray-800 pt-3">
                    <Button
                      variant="primary"
                      size="sm"
                      isLoading={togglingId === supervisor.id}
                      onClick={() => setConfirmToggle(supervisor)}
                    >
                      Reativar
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirmToggle && (
        <Modal
          isOpen={true}
          onClose={() => setConfirmToggle(null)}
          title="Reativar Supervisor"
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-300">
              Tem certeza que deseja reativar{' '}
              <span className="font-medium text-white">{confirmToggle.full_name}</span>?
            </p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setConfirmToggle(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleToggleActive(confirmToggle)}
              >
                Reativar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
