import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import { Alert, Badge, Button, Card, EmptyState, Select, Spinner } from '../../components/ui'
import { ClipboardIcon } from '../../components/icons'

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
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

const ACTION_OPTIONS = [
  { value: '', label: 'Todas as acoes' },
  { value: 'INSERT', label: 'Insercao' },
  { value: 'UPDATE', label: 'Atualizacao' },
  { value: 'DELETE', label: 'Exclusao' },
]

const PAGE_SIZE = 20
const HIDDEN_KEYS = new Set([
  'id',
  'created_at',
  'updated_at',
  'photo_url',
  'supervisor_signature',
  'requester_signature',
  'witness_signature',
  'record_id',
  'user_id',
  'created_by',
  'authorized_by',
  'last_withdrawal_id',
])

function diffKeys(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): string[] {
  const keys = new Set([
    ...Object.keys(oldData ?? {}),
    ...Object.keys(newData ?? {}),
  ])

  return Array.from(keys).filter((key) => {
    if (HIDDEN_KEYS.has(key)) return false
    return JSON.stringify(oldData?.[key]) !== JSON.stringify(newData?.[key])
  })
}

function importantSummary(row: AuditLogDisplay): string[] {
  const changed = diffKeys(row.old_data, row.new_data)
  return changed
    .slice(0, 5)
    .map((key) => {
      const before = formatValue(row.old_data?.[key])
      const after = formatValue(row.new_data?.[key])

      if (row.action === 'UPDATE') {
        return `${labelForKey(key)}: ${before} -> ${after}`
      }

      return `${labelForKey(key)}: ${after !== '-' ? after : before}`
    })
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao'
  if (typeof value === 'object') return 'Atualizado'
  return String(value)
}

function labelForKey(key: string): string {
  const map: Record<string, string> = {
    full_name: 'Nome',
    employee_id: 'Matricula',
    role: 'Perfil',
    sector: 'Setor',
    is_active: 'Status',
    name: 'Nome',
    code: 'Codigo',
    category: 'Categoria',
    current_quantity: 'Qtd atual',
    minimum_quantity: 'Qtd minima',
    quantity: 'Quantidade',
    unit: 'Unidade',
    notes: 'Observacoes',
    destination_type: 'Destino',
    collaborator_id: 'Colaborador',
    work_site_id: 'Obra',
    status: 'Status',
    job_title: 'Funcao',
    description: 'Descricao',
    ca_nr: 'CA/NR',
  }

  return map[key] ?? key
}

function ActionBadge({ action }: { action: AuditAction }) {
  const variantMap: Record<AuditAction, 'success' | 'warning' | 'danger'> = {
    INSERT: 'success',
    UPDATE: 'warning',
    DELETE: 'danger',
  }

  const labelMap: Record<AuditAction, string> = {
    INSERT: 'Criado',
    UPDATE: 'Alterado',
    DELETE: 'Removido',
  }

  return (
    <Badge variant={variantMap[action]} dot>
      {labelMap[action]}
    </Badge>
  )
}

function entityTitle(row: AuditLogDisplay): string {
  const source = row.new_data ?? row.old_data ?? {}

  if (typeof source.full_name === 'string' && source.full_name.trim()) {
    return source.full_name
  }

  if (typeof source.name === 'string' && source.name.trim()) {
    return source.name
  }

  if (typeof source.code === 'string' && source.code.trim()) {
    return source.code
  }

  const tableLabels: Record<string, string> = {
    people: 'Cadastro de colaborador',
    stock_items: 'Item de estoque',
    withdrawals: 'Retirada',
    person_inventories: 'Inventario individual',
    kits: 'Kit',
  }

  return tableLabels[row.table_name] ?? 'Registro'
}

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLogDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
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
        { value: '', label: 'Todos os usuarios' },
        ...(data as { id: string; full_name: string }[]).map((profile) => ({
          value: profile.id,
          label: profile.full_name,
        })),
      ])
    }
  }, [])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('audit_logs')
      .select(
        'id, user_id, action, table_name, record_id, old_data, new_data, created_at, profiles!audit_logs_user_id_fkey(full_name)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (dateFrom) {
      query = query.gte('created_at', new Date(`${dateFrom}T00:00:00`).toISOString())
    }
    if (dateTo) {
      query = query.lte('created_at', new Date(`${dateTo}T23:59:59`).toISOString())
    }
    if (actionFilter) {
      query = query.eq('action', actionFilter)
    }
    if (userFilter) {
      query = query.eq('user_id', userFilter)
    }

    const { data, error: fetchError, count } = await query

    if (fetchError) {
      setError(fetchError.message)
      setLogs([])
      setLoading(false)
      return
    }

    setTotalCount(count ?? 0)
    setLogs(
      ((data as unknown as AuditLogRow[]) ?? []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        user_name: row.profiles?.full_name ?? 'Sistema',
        action: row.action,
        table_name: row.table_name,
        old_data: row.old_data,
        new_data: row.new_data,
      })),
    )
    setLoading(false)
  }, [actionFilter, dateFrom, dateTo, page, userFilter])

  useEffect(() => {
    void fetchSupervisors()
  }, [fetchSupervisors])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const changedFieldCount = useMemo(
    () => logs.reduce((sum, row) => sum + diffKeys(row.old_data, row.new_data).length, 0),
    [logs],
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Log de Auditoria</h2>
        <p className="mt-1 text-sm text-gray-400">Somente eventos e campos importantes.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card variant="bordered" padding="md">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Eventos nesta pagina</p>
          <p className="mt-2 text-2xl font-semibold text-white">{logs.length}</p>
        </Card>
        <Card variant="bordered" padding="md">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Campos alterados</p>
          <p className="mt-2 text-2xl font-semibold text-orange-300">{changedFieldCount}</p>
        </Card>
        <Card variant="bordered" padding="md">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Total filtrado</p>
          <p className="mt-2 text-2xl font-semibold text-white">{totalCount}</p>
        </Card>
      </div>

      <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Data inicio</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Data fim</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />
          </div>
          <Select label="Acao" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} options={ACTION_OPTIONS} />
          <Select label="Usuario" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} options={supervisors} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => { setPage(0); void fetchLogs() }}>Aplicar filtros</Button>
          <Button size="sm" variant="secondary" onClick={() => {
            setDateFrom('')
            setDateTo('')
            setActionFilter('')
            setUserFilter('')
            setPage(0)
          }}>Limpar</Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-14">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-400">Carregando auditoria...</p>
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ClipboardIcon size={48} />}
          title="Nenhum evento encontrado"
          description="Tente ajustar periodo ou filtros."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {logs.map((log) => {
            const highlights = importantSummary(log)
            const changed = diffKeys(log.old_data, log.new_data)

            return (
              <Card key={log.id} variant="bordered" padding="md">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionBadge action={log.action} />
                      <span className="text-sm font-semibold text-orange-200">{entityTitle(log)}</span>
                      <span className="text-sm font-medium text-white">{log.user_name}</span>
                      <span className="text-xs text-gray-500">{formatDateTime(log.created_at)}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {changed.slice(0, 6).map((field) => (
                        <span key={field} className="rounded-full border border-orange-500/15 bg-orange-500/10 px-2.5 py-1 text-[11px] text-orange-200">
                          {labelForKey(field)}
                        </span>
                      ))}
                      {changed.length > 6 && (
                        <span className="rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[11px] text-gray-400">
                          +{changed.length - 6}
                        </span>
                      )}
                    </div>

                    {highlights.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {highlights.map((item) => (
                          <div key={item} className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2 text-sm text-gray-300">
                            {item}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {totalCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount} eventos
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
              Anterior
            </Button>
            <span className="text-sm text-gray-400">Pagina {page + 1} de {totalPages}</span>
            <Button size="sm" variant="secondary" disabled={page >= totalPages - 1} onClick={() => setPage((value) => value + 1)}>
              Proxima
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
