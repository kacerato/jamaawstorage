import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { WithdrawalListItem, WithdrawalStatus } from '../../types'
import type { Tables } from '../../types/database'
import { Button, Input, Select, Badge, DataTable, EmptyState } from '../../components/ui'
import { ClipboardIcon } from '../../components/icons'
import { formatDateTime } from '../../lib/utils'

type PeopleRow = Tables<'people'>

type WithdrawalRowForTable = WithdrawalListItem & Record<string, unknown>

const statusOptions = [
  { value: '', label: 'Todas' },
  { value: 'completed', label: 'Concluídas' },
  { value: 'approved', label: 'Aprovadas' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'rejected', label: 'Rejeitadas/Canceladas' },
]

const statusBadgeVariant: Record<WithdrawalStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  completed: 'success',
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
}

const statusLabels: Record<WithdrawalStatus, string> = {
  completed: 'Concluída',
  approved: 'Aprovada',
  pending: 'Pendente',
  rejected: 'Rejeitada',
}

export function WithdrawalsPage() {
  const navigate = useNavigate()

  const [withdrawals, setWithdrawals] = useState<WithdrawalListItem[]>([])
  const [leaders, setLeaders] = useState<PeopleRow[]>([])
  const [loading, setLoading] = useState(true)

  const [searchCode, setSearchCode] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [leaderFilter, setLeaderFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    supabase
      .from('people')
      .select('*')
      .eq('is_active', true)
      .in('role', ['leader', 'supervisor'])
      .order('full_name')
      .then(({ data }) => {
        if (cancelled) return
        if (data) setLeaders(data as PeopleRow[])
      })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false

    const fetchWithdrawals = async () => {
      let query = supabase
        .from('withdrawals')
        .select(
          'id, code, requested_by, destination_type, collaborator_id, work_site_id, status, created_at, supervisor_signature, requester_signature, requested_by_person:people!requested_by(*), collaborator:people!collaborator_id(*), work_site:work_sites(*)',
        )
        .order('created_at', { ascending: false })

      if (searchCode.trim()) {
        query = query.ilike('code', `%${searchCode.trim()}%`)
      }
      if (statusFilter) {
        query = query.eq('status', statusFilter)
      }
      if (leaderFilter) {
        query = query.eq('requested_by', leaderFilter)
      }
      if (dateFrom) {
        query = query.gte('created_at', dateFrom)
      }
      if (dateTo) {
        query = query.lte('created_at', `${dateTo}T23:59:59`)
      }

      const { data, error } = await query

      if (cancelled) return
      if (error) {
        console.error('Error fetching withdrawals:', error.message)
        setWithdrawals([])
      } else {
        setWithdrawals((data as WithdrawalListItem[]) ?? [])
      }
      setLoading(false)
    }

    const timeout = setTimeout(() => {
      fetchWithdrawals()
    }, 300)

    return () => {
      clearTimeout(timeout)
      cancelled = true
    }
  }, [searchCode, statusFilter, leaderFilter, dateFrom, dateTo])

  const leaderOptions = useMemo(
    () => [
      { value: '', label: 'Todos os líderes' },
      ...leaders.map((l) => ({
        value: l.id,
        label: l.full_name,
      })),
    ],
    [leaders],
  )

  const tableData = useMemo<WithdrawalRowForTable[]>(
    () => withdrawals as WithdrawalRowForTable[],
    [withdrawals],
  )

  const columns = [
    {
      key: 'code' as const,
      header: 'Código',
      sortable: true,
      render: (_value: unknown, row: WithdrawalRowForTable) => (
        <span className="font-mono font-medium text-orange-400">
          {(row as unknown as WithdrawalListItem).code}
        </span>
      ),
    },
    {
      key: 'requested_by' as const,
      header: 'Líder Solicitante',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const w = row as unknown as WithdrawalListItem
        return w.requested_by_person?.full_name ?? '-'
      },
    },
    {
      key: 'destination_type' as const,
      header: 'Destino',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const w = row as unknown as WithdrawalListItem
        if (w.destination_type === 'collaborator') {
          return w.collaborator?.full_name ?? 'Colaborador'
        }
        return w.work_site?.name ?? 'Obra'
      },
    },
    {
      key: 'status' as const,
      header: 'Qtd Itens',
      render: () => '-',
      className: 'text-center',
    },
    {
      key: 'created_at' as const,
      header: 'Data',
      sortable: true,
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const w = row as unknown as WithdrawalListItem
        return formatDateTime(w.created_at)
      },
    },
    {
      key: 'status' as const,
      header: 'Status',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const w = row as unknown as WithdrawalListItem
        return (
          <Badge variant={statusBadgeVariant[w.status]} dot size="sm">
            {statusLabels[w.status]}
          </Badge>
        )
      },
    },
    {
      key: 'signatures' as const,
      header: 'Assinaturas',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const w = row as unknown as WithdrawalListItem
        const both = !!w.supervisor_signature && !!w.requester_signature
        return both ? (
          <span className="text-emerald-400">✓</span>
        ) : (
          <span className="text-gray-500">—</span>
        )
      },
      className: 'text-center',
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Retiradas</h2>
          <p className="mt-1 text-sm text-gray-400">
            Registro e acompanhamento de retiradas de EPIs e materiais
          </p>
        </div>
        <Button
          onClick={() => navigate('/withdrawals/new')}
          leftIcon={<ClipboardIcon size={16} />}
        >
          Nova Retirada
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-700 bg-gray-900 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Input
              placeholder="Buscar por código..."
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
            />
          </div>
          <div className="w-44">
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              placeholder="Status"
            />
          </div>
          <div className="w-52">
            <Select
              options={leaderOptions}
              value={leaderFilter}
              onChange={(e) => setLeaderFilter(e.target.value)}
              placeholder="Líder"
            />
          </div>
          <div className="w-40">
            <Input
              type="date"
              placeholder="De"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Input
              type="date"
              placeholder="Até"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {!loading && withdrawals.length === 0 && !searchCode && !statusFilter && !leaderFilter ? (
        <EmptyState
          icon={<ClipboardIcon size={48} />}
          title="Nenhuma retirada registrada"
          description="Clique em 'Nova Retirada' para registrar a primeira retirada."
          action={{
            label: 'Nova Retirada',
            onClick: () => navigate('/withdrawals/new'),
          }}
        />
      ) : (
        <DataTable<WithdrawalRowForTable>
          columns={columns}
          data={tableData}
          keyExtractor={(row) => (row as unknown as WithdrawalListItem).id}
          isLoading={loading}
          emptyMessage="Nenhuma retirada encontrada com os filtros aplicados"
          onRowClick={(row) => {
            const w = row as unknown as WithdrawalListItem
            navigate(`/withdrawals/${w.id}`)
          }}
        />
      )}
    </div>
  )
}
