import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import { Button, Select, Badge, DataTable, Alert } from '../../components/ui'

type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE'

interface AuditLogRow {
  id: string
  user_id: string | null
  action: AuditAction
  table_name: string
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
  profiles: { full_name: string } | null
}

interface AuditLogDisplay {
  id: string
  created_at: string
  user_name: string
  action: AuditAction
  table_name: string
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  [key: string]: unknown
}

const TABLE_OPTIONS = [
  { value: '', label: 'Todas as tabelas' },
  { value: 'people', label: 'Pessoas' },
  { value: 'stock_items', label: 'Itens de Estoque' },
  { value: 'withdrawals', label: 'Retiradas' },
  { value: 'kits', label: 'Kits' },
  { value: 'work_sites', label: 'Obras' },
  { value: 'person_inventories', label: 'Inventários' },
]

const ACTION_OPTIONS = [
  { value: '', label: 'Todas as ações' },
  { value: 'INSERT', label: 'Inserção' },
  { value: 'UPDATE', label: 'Atualização' },
  { value: 'DELETE', label: 'Exclusão' },
]

const PAGE_SIZE = 50

function JsonBlock({ data }: { data: Record<string, unknown> | null }) {
  const [expanded, setExpanded] = useState(false)

  if (!data) return <span className="text-gray-600">—</span>

  return (
    <div className="max-w-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
      >
        {expanded ? 'Fechar' : 'Ver dados'}
      </button>
      {expanded && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-gray-950 p-2 text-xs text-emerald-400 border border-gray-800">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ActionBadge({ action }: { action: AuditAction }) {
  const variantMap: Record<AuditAction, 'success' | 'warning' | 'danger'> = {
    INSERT: 'success',
    UPDATE: 'warning',
    DELETE: 'danger',
  }
  const labelMap: Record<AuditAction, string> = {
    INSERT: 'Inserção',
    UPDATE: 'Atualização',
    DELETE: 'Exclusão',
  }

  return (
    <Badge variant={variantMap[action]} dot>
      {labelMap[action]}
    </Badge>
  )
}

const TABLE_LABEL_MAP: Record<string, string> = {
  people: 'Pessoas',
  stock_items: 'Itens de Estoque',
  withdrawals: 'Retiradas',
  kits: 'Kits',
  work_sites: 'Obras',
  person_inventories: 'Inventários',
  profiles: 'Perfis',
  stock_item_lots: 'Lotes',
  withdrawal_items: 'Itens de Retirada',
  kit_items: 'Itens de Kit',
}

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLogDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [tableFilter, setTableFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')

  const [supervisors, setSupervisors] = useState<{ value: string; label: string }[]>([])

  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const fetchSupervisors = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'supervisor')
      .eq('is_active', true)
      .order('full_name')

    if (data) {
      setSupervisors([
        { value: '', label: 'Todos os usuários' },
        ...(data as { id: string; full_name: string }[]).map((p) => ({ value: p.id, label: p.full_name })),
      ])
    }
  }, [])

  const buildQuery = useCallback(() => {
    let query = supabase
      .from('audit_logs')
      .select('id, user_id, action, table_name, record_id, old_data, new_data, created_at, profiles!audit_logs_user_id_fkey(full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (dateFrom) {
      query = query.gte('created_at', new Date(dateFrom + 'T00:00:00').toISOString())
    }
    if (dateTo) {
      query = query.lte('created_at', new Date(dateTo + 'T23:59:59').toISOString())
    }
    if (tableFilter) {
      query = query.eq('table_name', tableFilter)
    }
    if (actionFilter) {
      query = query.eq('action', actionFilter)
    }
    if (userFilter) {
      query = query.eq('user_id', userFilter)
    }

    return query
  }, [page, dateFrom, dateTo, tableFilter, actionFilter, userFilter])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)

    const query = buildQuery()
    const { data, error: fetchError, count } = await query

    if (fetchError) {
      setError(fetchError.message)
      setLogs([])
      setLoading(false)
      return
    }

    setTotalCount(count ?? 0)

    if (!data) {
      setLogs([])
      setLoading(false)
      return
    }

    const mapped: AuditLogDisplay[] = (data as unknown as AuditLogRow[]).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      user_name: row.profiles?.full_name ?? 'Sistema',
      action: row.action,
      table_name: row.table_name,
      record_id: row.record_id,
      old_data: row.old_data,
      new_data: row.new_data,
    }))

    setLogs(mapped)
    setLoading(false)
  }, [buildQuery])

  useEffect(() => {
    setTimeout(() => void fetchSupervisors(), 0)
  }, [fetchSupervisors])

  useEffect(() => {
    setTimeout(() => void fetchLogs(), 0)
  }, [fetchLogs])

  const handleApplyFilters = () => {
    setPage(0)
    void fetchLogs()
  }

  const handleClearFilters = () => {
    setDateFrom('')
    setDateTo('')
    setTableFilter('')
    setActionFilter('')
    setUserFilter('')
    setPage(0)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const columns = [
    {
      key: 'created_at',
      header: 'Data/Hora',
      sortable: true,
      className: 'w-40',
      render: (value: unknown) => (
        <span className="whitespace-nowrap">{formatDateTime(value as string)}</span>
      ),
    },
    {
      key: 'user_name',
      header: 'Usuário',
      sortable: true,
      className: 'w-36',
      render: (value: unknown) => (
        <span className="font-medium text-white">{value as string}</span>
      ),
    },
    {
      key: 'action',
      header: 'Ação',
      className: 'w-32',
      render: (value: unknown) => <ActionBadge action={value as AuditAction} />,
    },
    {
      key: 'table_name',
      header: 'Tabela',
      sortable: true,
      className: 'w-36',
      render: (value: unknown) => (
        <span className="whitespace-nowrap">
          {TABLE_LABEL_MAP[value as string] ?? (value as string)}
        </span>
      ),
    },
    {
      key: 'record_id',
      header: 'ID Registro',
      className: 'w-28',
      render: (value: unknown) => {
        const id = value as string | null
        if (!id) return <span className="text-gray-600">—</span>
        return (
          <span className="font-mono text-xs text-gray-400" title={id}>
            {id.slice(0, 8)}...
          </span>
        )
      },
    },
    {
      key: 'old_data',
      header: 'Dados Anteriores',
      render: (value: unknown) => <JsonBlock data={value as Record<string, unknown> | null} />,
    },
    {
      key: 'new_data',
      header: 'Dados Novos',
      render: (value: unknown) => <JsonBlock data={value as Record<string, unknown> | null} />,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Log de Auditoria</h2>
        <p className="mt-1 text-sm text-gray-400">
          Registro de todas as alterações no sistema
        </p>
      </div>

      <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Data Início</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Data Fim</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />
          </div>
          <Select
            label="Tabela"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            options={TABLE_OPTIONS}
          />
          <Select
            label="Ação"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            options={ACTION_OPTIONS}
          />
          <Select
            label="Usuário"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            options={supervisors}
          />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={handleApplyFilters}>
            Aplicar Filtros
          </Button>
          <Button size="sm" variant="secondary" onClick={handleClearFilters}>
            Limpar
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable<AuditLogDisplay>
        columns={columns}
        data={logs}
        keyExtractor={(row) => row.id}
        isLoading={loading}
        emptyMessage="Nenhum registro de auditoria encontrado"
      />

      {totalCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de{' '}
            {totalCount} registros
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page === 0}
              onClick={() => {
                setPage((p) => p - 1)
              }}
            >
              Anterior
            </Button>
            <span className="text-sm text-gray-400">
              Página {page + 1} de {totalPages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages - 1}
              onClick={() => {
                setPage((p) => p + 1)
              }}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
