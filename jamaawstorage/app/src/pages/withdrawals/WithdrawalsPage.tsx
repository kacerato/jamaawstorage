import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { WithdrawalListItem, WithdrawalStatus } from '../../types'
import type { Tables } from '../../types/database'
import { Button, Input, Select, Badge, DataTable, EmptyState, Alert } from '../../components/ui'
import { ClipboardIcon } from '../../components/icons'
import { formatDateTime } from '../../lib/utils'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

type PeopleRow = Tables<'people'>
type WithdrawalRowForTable = WithdrawalListItem & Record<string, unknown>

const withdrawalsPageCache: {
  withdrawals: WithdrawalListItem[]
  requesters: PeopleRow[]
} = {
  withdrawals: [],
  requesters: [],
}

const statusOptions = [
  { value: '', label: 'Todas' },
  { value: 'completed', label: 'Concluidas' },
  { value: 'rejected', label: 'Rejeitadas/Canceladas' },
]

const statusBadgeVariant: Record<WithdrawalStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  completed: 'success',
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
}

const statusLabels: Record<WithdrawalStatus, string> = {
  completed: 'Concluida',
  approved: 'Aprovada',
  pending: 'Pendente',
  rejected: 'Rejeitada',
}

function withdrawalItemDestinationLabel(
  item: NonNullable<WithdrawalListItem['withdrawal_items']>[number],
  withdrawal: WithdrawalListItem,
): string {
  const destinationType = item.destination_type ?? withdrawal.destination_type

  if (destinationType === 'collaborator') {
    const collaborator = item.collaborator ?? withdrawal.collaborator
    return collaborator?.full_name ?? 'Colaborador'
  }

  return item.work_site?.name ?? withdrawal.work_site?.name ?? 'Obra'
}

function withdrawalDestinationsSummary(withdrawal: WithdrawalListItem): string {
  const itemDestinations = withdrawal.withdrawal_items?.map((item) =>
    withdrawalItemDestinationLabel(item, withdrawal),
  ) ?? []
  const uniqueDestinations = Array.from(new Set(itemDestinations.filter(Boolean)))

  if (uniqueDestinations.length > 0) {
    return uniqueDestinations.join(' / ')
  }

  if (withdrawal.destination_type === 'collaborator') {
    return withdrawal.collaborator?.full_name ?? 'Colaborador'
  }

  return withdrawal.work_site?.name ?? 'Obra'
}

export function WithdrawalsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''
  const createdCount = Number(searchParams.get('created') ?? '0')
  const [withdrawals, setWithdrawals] = useState<WithdrawalListItem[]>(withdrawalsPageCache.withdrawals)
  const [requesters, setRequesters] = useState<PeopleRow[]>(withdrawalsPageCache.requesters)
  const [loading, setLoading] = useState(withdrawalsPageCache.withdrawals.length === 0)
  const [refreshing, setRefreshing] = useState(false)

  const [searchCode, setSearchCode] = useState(initialQuery)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [leaderFilter, setLeaderFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const debouncedSearchCode = useDebouncedValue(searchCode, 220)

  useEffect(() => {
    let cancelled = false

    if (withdrawalsPageCache.requesters.length > 0) return

    void supabase
      .from('people')
      .select('*')
      .eq('is_active', true)
      .in('role', ['leader', 'supervisor'])
      .order('full_name')
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          const nextRequesters = data as PeopleRow[]
          withdrawalsPageCache.requesters = nextRequesters
          setRequesters(nextRequesters)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const fetchWithdrawals = async () => {
      const shouldShowFullLoading = withdrawals.length === 0
      if (shouldShowFullLoading) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      let query = supabase
        .from('withdrawals')
        .select(
          `id, code, requested_by, destination_type, collaborator_id, work_site_id, status, created_at, supervisor_signature, requester_signature,
          withdrawal_items(id, destination_type, collaborator_id, work_site_id, collaborator:people!withdrawal_items_collaborator_id_fkey(id, full_name, employee_id), work_site:work_sites!withdrawal_items_work_site_id_fkey(id, name)),
          requested_by_person:people!withdrawals_requested_by_fkey(id, full_name),
          collaborator:people!withdrawals_collaborator_id_fkey(id, full_name),
          work_site:work_sites!withdrawals_work_site_id_fkey(id, name)`,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .limit(100)

      if (debouncedSearchCode.trim()) {
        query = query.ilike('code', `%${debouncedSearchCode.trim()}%`)
      }
      if (statusFilter) {
        query = query.eq('status', statusFilter as never)
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
        const nextWithdrawals = (data as unknown as WithdrawalListItem[]) ?? []
        withdrawalsPageCache.withdrawals = nextWithdrawals
        setWithdrawals(nextWithdrawals)
      }

      setLoading(false)
      setRefreshing(false)
    }

    void fetchWithdrawals()

    return () => {
      cancelled = true
    }
  }, [debouncedSearchCode, statusFilter, leaderFilter, dateFrom, dateTo, withdrawals.length])

  useEffect(() => {
    const nextQuery = searchParams.get('q') ?? ''
    if (nextQuery !== searchCode) {
      setSearchCode(nextQuery)
    }
  }, [searchParams, searchCode])

  const requesterOptions = useMemo(
    () => [
      { value: '', label: 'Todos os solicitantes' },
      ...requesters.map((requester) => ({
        value: requester.id,
        label: requester.full_name,
      })),
    ],
    [requesters]
  )

  const tableData = useMemo<WithdrawalRowForTable[]>(
    () => withdrawals as WithdrawalRowForTable[],
    [withdrawals]
  )

  const columns = [
    {
      key: 'code' as const,
      header: 'Codigo',
      sortable: true,
      render: (_value: unknown, row: WithdrawalRowForTable) => (
        <span className="font-mono font-medium text-orange-400">
          {(row as unknown as WithdrawalListItem).code}
        </span>
      ),
    },
    {
      key: 'requested_by' as const,
      header: 'Solicitante',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const withdrawal = row as unknown as WithdrawalListItem
        return withdrawal.requested_by_person?.full_name ?? '-'
      },
    },
    {
      key: 'destination_type' as const,
      header: 'Destino',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const withdrawal = row as unknown as WithdrawalListItem
        return withdrawalDestinationsSummary(withdrawal)
      },
    },
    {
      key: 'item_count' as const,
      header: 'Qtd Itens',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const withdrawal = row as unknown as WithdrawalListItem
        return withdrawal.withdrawal_items?.length ?? 0
      },
      className: 'text-center',
    },
    {
      key: 'created_at' as const,
      header: 'Data',
      sortable: true,
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const withdrawal = row as unknown as WithdrawalListItem
        return formatDateTime(withdrawal.created_at)
      },
    },
    {
      key: 'status' as const,
      header: 'Status',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const withdrawal = row as unknown as WithdrawalListItem
        return (
          <Badge variant={statusBadgeVariant[withdrawal.status]} dot size="sm">
            {statusLabels[withdrawal.status]}
          </Badge>
        )
      },
    },
    {
      key: 'signatures' as const,
      header: 'Assinaturas',
      render: (_value: unknown, row: WithdrawalRowForTable) => {
        const withdrawal = row as unknown as WithdrawalListItem
        const both = !!withdrawal.supervisor_signature && !!withdrawal.requester_signature
        return both ? (
          <span className="text-emerald-400">OK</span>
        ) : (
          <span className="text-gray-500">-</span>
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

      {createdCount > 0 && (
        <Alert variant="success">
          {createdCount === 1
            ? 'Retirada criada com sucesso.'
            : `${createdCount} retiradas foram criadas com sucesso.`}
        </Alert>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Input
              placeholder="Buscar por codigo..."
              value={searchCode}
              onChange={(e) => {
                const nextValue = e.target.value
                setSearchCode(nextValue)
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  if (nextValue.trim()) {
                    next.set('q', nextValue)
                  } else {
                    next.delete('q')
                  }
                  return next
                })
              }}
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
              options={requesterOptions}
              value={leaderFilter}
              onChange={(e) => setLeaderFilter(e.target.value)}
              placeholder="Solicitante"
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
              placeholder="Ate"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>

        {refreshing && (
          <div className="inline-flex items-center gap-2 text-xs text-orange-200/75">
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
            Atualizando retiradas...
          </div>
        )}
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
            const withdrawal = row as unknown as WithdrawalListItem
            navigate(`/withdrawals/${withdrawal.id}`)
          }}
        />
      )}
    </div>
  )
}
