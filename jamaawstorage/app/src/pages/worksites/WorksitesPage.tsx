import { useState, useEffect, useCallback } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { Button, Badge, DataTable, Modal, Alert, StatCard, Spinner } from '../../components/ui'
import { BuildingIcon, PackageIcon } from '../../components/icons'
import { WorksiteForm } from './WorksiteForm'

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

export function WorksitesPage() {
  useAuth()

  const [worksites, setWorksites] = useState<WorksiteWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [showFormModal, setShowFormModal] = useState(false)
  const [editingWorksite, setEditingWorksite] = useState<WorkSiteRow | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedWorksite, setSelectedWorksite] = useState<WorksiteWithStats | null>(null)
  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalSummary[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchWorksites = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('work_sites')
      .select('*, withdrawals(id)')
      .order('name')

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    if (!data) {
      setWorksites([])
      setLoading(false)
      return
    }

    const mapped: WorksiteWithStats[] = (data as unknown as RawWorksiteRow[]).map((row) => {
      const withdrawals = row.withdrawals ?? []
      return {
        id: row.id,
        name: row.name,
        location: row.location,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        total_withdrawals: withdrawals.length,
        total_items_dispatched: 0,
      }
    })

    setWorksites(mapped)
    setLoading(false)
  }, [])

  useEffect(() => {
    setTimeout(() => void fetchWorksites(), 0)
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

    if (!data) {
      setWithdrawalHistory([])
      setLoadingHistory(false)
      return
    }

    const mapped: WithdrawalSummary[] = (data as unknown as RawWithdrawalRow[]).map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      created_at: row.created_at,
      requester_name: row.requested_by_person?.full_name ?? '—',
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
      prev.map((w) =>
        w.id === worksite.id ? { ...w, is_active: !w.is_active } : w,
      ),
    )
    setDeleteConfirmId(null)
  }

  const handleRowClick = (worksite: WorksiteWithStats) => {
    setSelectedWorksite(worksite)
    setShowDetailModal(true)
    void fetchWithdrawalHistory(worksite.id)
  }

  const handleFormSubmit = () => {
    setShowFormModal(false)
    setEditingWorksite(null)
    void fetchWorksites()
  }

  const handleFormCancel = () => {
    setShowFormModal(false)
    setEditingWorksite(null)
  }

  const handleEdit = (worksite: WorksiteWithStats) => {
    setEditingWorksite(worksite)
    setShowFormModal(true)
    setShowDetailModal(false)
  }

  const filteredWorksites = worksites.filter((w) => {
    const matchesSearch =
      search === '' ||
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.location ?? '').toLowerCase().includes(search.toLowerCase())

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && w.is_active) ||
      (statusFilter === 'inactive' && !w.is_active)

    return matchesSearch && matchesStatus
  })

  const activeCount = worksites.filter((w) => w.is_active).length
  const inactiveCount = worksites.filter((w) => !w.is_active).length

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
      render: (value: unknown) => (value as string | null) ?? '—',
    },
    {
      key: 'is_active',
      header: 'Status',
      sortable: true,
      render: (value: unknown) =>
        value as boolean ? (
          <Badge variant="success" dot>Ativa</Badge>
        ) : (
          <Badge variant="danger" dot>Inativa</Badge>
        ),
    },
    {
      key: 'total_withdrawals',
      header: 'Retiradas',
      render: (value: unknown) => (
        <span className="text-gray-300">{value as number}</span>
      ),
    },
    {
      key: 'created_at',
      header: 'Criada em',
      sortable: true,
      render: (value: unknown) => (
        <span className="whitespace-nowrap">{formatDate(value as string)}</span>
      ),
    },
  ]

  const statusFilterOptions = [
    { value: 'all', label: 'Todas' },
    { value: 'active', label: 'Ativas' },
    { value: 'inactive', label: 'Inativas' },
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
          <h2 className="text-2xl font-bold text-white">Obras / Locais de Destino</h2>
          <p className="mt-1 text-sm text-gray-400">
            Cadastro de obras e destinos para retiradas
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingWorksite(null)
            setShowFormModal(true)
          }}
          leftIcon={<BuildingIcon size={16} />}
        >
          Nova Obra
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Total de Obras"
          value={worksites.length}
          icon={<BuildingIcon size={20} />}
        />
        <StatCard
          title="Obras Ativas"
          value={activeCount}
          icon={<BuildingIcon size={20} />}
          variant="default"
        />
        <StatCard
          title="Obras Inativas"
          value={inactiveCount}
          icon={<BuildingIcon size={20} />}
          variant={inactiveCount > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1">
          <input
            type="text"
            placeholder="Buscar por nome ou localização..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pl-10 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          />
        </div>
        <div className="min-w-[120px]">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="w-full appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-10 text-sm text-white transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          >
            {statusFilterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

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
        onRowClick={handleRowClick}
      />

      {deleteConfirmId && (
        <ConfirmToggleModal
          worksite={worksites.find((w) => w.id === deleteConfirmId) ?? null}
          onConfirm={() => {
            const ws = worksites.find((w) => w.id === deleteConfirmId)
            if (ws) void handleToggleActive(ws)
          }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}

      <Modal
        isOpen={showFormModal}
        onClose={handleFormCancel}
        title={editingWorksite ? 'Editar Obra' : 'Nova Obra'}
        size="lg"
      >
        <WorksiteForm
          worksite={editingWorksite}
          onSubmit={handleFormSubmit}
          onCancel={handleFormCancel}
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
              <div>
                <p className="text-sm font-medium text-gray-400">Nome</p>
                <p className="mt-1 text-base font-semibold text-white">{selectedWorksite.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">Localização</p>
                <p className="mt-1 text-base text-gray-300">{selectedWorksite.location ?? '—'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">Status</p>
                <div className="mt-1">
                  {selectedWorksite.is_active ? (
                    <Badge variant="success" dot>Ativa</Badge>
                  ) : (
                    <Badge variant="danger" dot>Inativa</Badge>
                  )}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">Criada em</p>
                <p className="mt-1 text-base text-gray-300">{formatDate(selectedWorksite.created_at)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-400">Total de Retiradas</p>
                <p className="mt-1 text-base text-gray-300">{selectedWorksite.total_withdrawals}</p>
              </div>
            </div>

            <div className="flex gap-3 border-t border-gray-700 pt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleEdit(selectedWorksite)}
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
              <h3 className="mb-3 text-base font-semibold text-white flex items-center gap-2">
                <PackageIcon size={18} />
                Histórico de Retiradas
              </h3>
              {loadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                </div>
              ) : withdrawalHistory.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">Nenhuma retirada registrada para esta obra.</p>
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
                      {withdrawalHistory.map((w) => (
                        <tr key={w.id} className="border-t border-gray-800">
                          <td className="px-4 py-3 text-sm font-mono text-orange-400">{w.code}</td>
                          <td className="px-4 py-3 text-sm text-gray-300">{w.requester_name}</td>
                          <td className="px-4 py-3 text-sm">
                            <Badge variant={statusBadgeMap[w.status] ?? 'default'} dot>
                              {statusLabelMap[w.status] ?? w.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-300">{w.items_count}</td>
                          <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{formatDate(w.created_at)}</td>
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

interface ConfirmToggleModalProps {
  worksite: WorksiteWithStats | null
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmToggleModal({ worksite, onConfirm, onCancel }: ConfirmToggleModalProps) {
  if (!worksite) return null

  const isDeactivating = worksite.is_active

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={isDeactivating ? 'Desativar Obra' : 'Reativar Obra'}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-300">
          Tem certeza que deseja {isDeactivating ? 'desativar' : 'reativar'} a obra{' '}
          <span className="font-medium text-white">{worksite.name}</span>?
        </p>
        {isDeactivating && worksite.total_withdrawals > 0 && (
          <p className="text-xs text-amber-400">
            Esta obra possui {worksite.total_withdrawals} retirada(s) associada(s). A obra será marcada como inativa, mas o histórico será mantido.
          </p>
        )}
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

interface RawWorksiteRow {
  id: string
  name: string
  location: string | null
  is_active: boolean
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
