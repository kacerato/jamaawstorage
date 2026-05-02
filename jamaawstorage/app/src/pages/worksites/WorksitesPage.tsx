import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { Button, Badge, DataTable, Modal, Alert, StatCard, Spinner, Input } from '../../components/ui'
import { BuildingIcon, PackageIcon } from '../../components/icons'
import { WorksiteForm } from './WorksiteForm'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

type WorkSiteRow = Tables<'work_sites'>

interface WorksiteWithStats extends WorkSiteRow {
  total_withdrawals: number
  total_items_dispatched: number
  [key: string]: unknown
}

interface WithdrawalSummary {
  id: string
  code: string
  status: string
  created_at: string
  requester_name: string
  items_count: number
}

interface RawWorksiteRow {
  id: string
  name: string
  description: string | null
  location: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  withdrawals: { id: string }[]
}

interface RawWithdrawalRow {
  id: string
  code: string
  status: string
  created_at: string
  requested_by_person: { full_name: string } | null
  withdrawal_items: { id: string }[]
}

const worksitesPageCache: {
  worksites: WorksiteWithStats[]
} = {
  worksites: [],
}

export function WorksitesPage() {
  const [worksites, setWorksites] = useState<WorksiteWithStats[]>(worksitesPageCache.worksites)
  const [loading, setLoading] = useState(worksitesPageCache.worksites.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 220)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [showFormModal, setShowFormModal] = useState(false)
  const [editingWorksite, setEditingWorksite] = useState<WorkSiteRow | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedWorksite, setSelectedWorksite] = useState<WorksiteWithStats | null>(null)
  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalSummary[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchWorksites = useCallback(async () => {
    const shouldShowFullLoading = worksites.length === 0
    if (shouldShowFullLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('work_sites')
        .select('*, withdrawals(id)')
        .order('name')

      if (fetchError) {
        setError(fetchError.message)
        return
      }

      const mapped: WorksiteWithStats[] = ((data as RawWorksiteRow[]) ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        location: row.location,
        is_active: row.is_active,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        total_withdrawals: row.withdrawals?.length ?? 0,
        total_items_dispatched: 0,
      }))

      worksitesPageCache.worksites = mapped
      setWorksites(mapped)
    } catch (err) {
      console.error('Error fetching worksites:', err)
      setError('Erro ao carregar obras.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [worksites.length])

  useEffect(() => {
    void fetchWorksites()
  }, [fetchWorksites])

  const fetchWithdrawalHistory = useCallback(async (worksiteId: string) => {
    setLoadingHistory(true)

    const { data, error: fetchError } = await supabase
      .from('withdrawals')
      .select('id, code, status, created_at, requested_by_person:people!withdrawals_requested_by_fkey(full_name), withdrawal_items(id)')
      .eq('work_site_id', worksiteId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (fetchError) {
      setWithdrawalHistory([])
      setLoadingHistory(false)
      return
    }

    const mapped: WithdrawalSummary[] = ((data as RawWithdrawalRow[]) ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      created_at: row.created_at,
      requester_name: row.requested_by_person?.full_name ?? '-',
      items_count: row.withdrawal_items?.length ?? 0,
    }))

    setWithdrawalHistory(mapped)
    setLoadingHistory(false)
  }, [])

  const handleToggleActive = async (worksite: WorksiteWithStats) => {
    setDeleteConfirmId(worksite.id)

    const { error: updateError } = await supabase
      .from('work_sites')
      .update({ is_active: !worksite.is_active, updated_at: new Date().toISOString() })
      .eq('id', worksite.id)

    if (updateError) {
      setError(updateError.message)
      setDeleteConfirmId(null)
      return
    }

    setWorksites((prev) =>
      prev.map((current) =>
        current.id === worksite.id ? { ...current, is_active: !current.is_active } : current
      )
    )
    setDeleteConfirmId(null)
  }

  const filteredWorksites = worksites.filter((worksite) => {
    const matchesSearch =
      debouncedSearch === '' ||
      worksite.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      (worksite.location ?? '').toLowerCase().includes(debouncedSearch.toLowerCase())

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && worksite.is_active) ||
      (statusFilter === 'inactive' && !worksite.is_active)

    return matchesSearch && matchesStatus
  })

  const activeCount = worksites.filter((worksite) => worksite.is_active).length
  const inactiveCount = worksites.filter((worksite) => !worksite.is_active).length

  const columns = [
    {
      key: 'name',
      header: 'Nome',
      sortable: true,
      render: (_value: unknown, row: WorksiteWithStats) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-orange-500">
            <BuildingIcon size={16} />
          </div>
          <span className="font-medium text-white">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Localização',
      sortable: true,
      render: (value: unknown) => (value as string | null) ?? '-',
    },
    {
      key: 'is_active',
      header: 'Status',
      sortable: true,
      render: (value: unknown) =>
        value ? <Badge variant="success" dot>Ativa</Badge> : <Badge variant="danger" dot>Inativa</Badge>,
    },
    {
      key: 'total_withdrawals',
      header: 'Retiradas',
      render: (value: unknown) => <span className="text-gray-300">{value as number}</span>,
    },
    {
      key: 'created_at',
      header: 'Criada em',
      sortable: true,
      render: (value: unknown) => <span className="whitespace-nowrap">{formatDate(value as string)}</span>,
    },
  ]

  const statusBadgeMap: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    completed: 'info',
  }

  const statusLabelMap: Record<string, string> = {
    pending: 'Pendente',
    approved: 'Aprovada',
    rejected: 'Rejeitada',
    completed: 'Concluída',
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Obras</h2>
          <p className="mt-1 text-sm text-gray-400">Cadastro de obras e destinos para retiradas</p>
        </div>
        <Button
          onClick={() => {
            setEditingWorksite(null)
            setShowFormModal(true)
          }}
          leftIcon={<BuildingIcon size={16} />}
        >
          Nova obra
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Total de Obras" value={worksites.length} icon={<BuildingIcon size={20} />} />
        <StatCard title="Obras Ativas" value={activeCount} icon={<BuildingIcon size={20} />} variant="default" />
        <StatCard title="Obras Inativas" value={inactiveCount} icon={<BuildingIcon size={20} />} variant={inactiveCount > 0 ? 'warning' : 'default'} />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[220px] flex-1">
          <Input
            placeholder="Buscar por nome ou localização..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="min-w-[150px]">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}
            className="w-full appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          >
            <option value="all">Todas</option>
            <option value="active">Ativas</option>
            <option value="inactive">Inativas</option>
          </select>
        </div>
      </div>

      {refreshing && (
        <div className="inline-flex items-center gap-2 text-xs text-orange-200/75">
          <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
          Atualizando obras...
        </div>
      )}

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable<WorksiteWithStats>
        columns={columns}
        data={filteredWorksites}
        keyExtractor={(row) => row.id}
        isLoading={loading}
        emptyMessage="Nenhuma obra encontrada"
        onRowClick={(row) => {
          setSelectedWorksite(row)
          setShowDetailModal(true)
          void fetchWithdrawalHistory(row.id)
        }}
      />

      {deleteConfirmId && (
        <ConfirmToggleModal
          worksite={worksites.find((worksite) => worksite.id === deleteConfirmId) ?? null}
          onConfirm={() => {
            const worksite = worksites.find((current) => current.id === deleteConfirmId)
            if (worksite) void handleToggleActive(worksite)
          }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}

      <Modal isOpen={showFormModal} onClose={() => setShowFormModal(false)} title={editingWorksite ? 'Editar Obra' : 'Nova Obra'} size="lg">
        <WorksiteForm
          worksite={editingWorksite}
          onSubmit={() => {
            setShowFormModal(false)
            setEditingWorksite(null)
            void fetchWorksites()
          }}
          onCancel={() => {
            setShowFormModal(false)
            setEditingWorksite(null)
          }}
        />
      </Modal>

      <Modal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false)
          setSelectedWorksite(null)
          setWithdrawalHistory([])
        }}
        title={selectedWorksite?.name ?? 'Detalhes da Obra'}
        size="xl"
      >
        {selectedWorksite && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DetailField label="Nome" value={selectedWorksite.name} />
              <DetailField label="Localização" value={selectedWorksite.location ?? '-'} />
              <DetailField
                label="Status"
                value={selectedWorksite.is_active ? <Badge variant="success" dot>Ativa</Badge> : <Badge variant="danger" dot>Inativa</Badge>}
              />
              <DetailField label="Criada em" value={formatDate(selectedWorksite.created_at)} />
              <DetailField label="Total de Retiradas" value={selectedWorksite.total_withdrawals} />
            </div>

            <div className="flex gap-3 border-t border-gray-700 pt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingWorksite(selectedWorksite)
                  setShowDetailModal(false)
                  setShowFormModal(true)
                }}
              >
                Editar
              </Button>
              <Button
                size="sm"
                variant={selectedWorksite.is_active ? 'danger' : 'primary'}
                onClick={() => {
                  setShowDetailModal(false)
                  setDeleteConfirmId(selectedWorksite.id)
                }}
              >
                {selectedWorksite.is_active ? 'Desativar' : 'Reativar'}
              </Button>
            </div>

            <div className="border-t border-gray-700 pt-4">
              <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
                <PackageIcon size={18} />
                Histórico de Retiradas
              </h3>
              {loadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                </div>
              ) : withdrawalHistory.length === 0 ? (
                <p className="py-4 text-sm text-gray-400">Nenhuma retirada registrada para esta obra.</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-700">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-800">
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Código</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Solicitante</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Itens</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withdrawalHistory.map((withdrawal) => (
                        <tr key={withdrawal.id} className="border-t border-gray-800">
                          <td className="px-4 py-3 text-sm font-mono text-orange-400">{withdrawal.code}</td>
                          <td className="px-4 py-3 text-sm text-gray-300">{withdrawal.requester_name}</td>
                          <td className="px-4 py-3 text-sm">
                            <Badge variant={statusBadgeMap[withdrawal.status] ?? 'default'} dot>
                              {statusLabelMap[withdrawal.status] ?? withdrawal.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-300">{withdrawal.items_count}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-400">{formatDate(withdrawal.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function ConfirmToggleModal({
  worksite,
  onConfirm,
  onCancel,
}: {
  worksite: WorksiteWithStats | null
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!worksite) return null

  const isDeactivating = worksite.is_active

  return (
    <Modal isOpen={true} onClose={onCancel} title={isDeactivating ? 'Desativar Obra' : 'Reativar Obra'} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-300">
          Tem certeza que deseja {isDeactivating ? 'desativar' : 'reativar'} a obra{' '}
          <span className="font-medium text-white">{worksite.name}</span>?
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant={isDeactivating ? 'danger' : 'primary'} onClick={onConfirm}>
            {isDeactivating ? 'Desativar' : 'Reativar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-400">{label}</p>
      <div className="mt-1 text-base text-gray-300">{value}</div>
    </div>
  )
}
