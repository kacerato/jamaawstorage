import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { StockReturnStatus, Tables } from '../../types/database'
import { formatDateTime } from '../../lib/utils'
import { Alert, Badge, Button, Card, DataTable, EmptyState, Select, Spinner } from '../../components/ui'
import { PackageIcon } from '../../components/icons'

type StockReturnRow = Tables<'stock_returns'>

interface ReturnListItem extends StockReturnRow {
  source_person: { id: string; full_name: string } | null
  source_work_site: { id: string; name: string } | null
  item_count: number
  total_quantity: number
}

type ReturnTableRow = ReturnListItem & Record<string, unknown>

const STATUS_META: Record<StockReturnStatus, { label: string; variant: 'default' | 'warning' | 'info' | 'success' | 'danger' }> = {
  draft: { label: 'Rascunho', variant: 'default' },
  awaiting_triage: { label: 'Aguardando triagem', variant: 'warning' },
  triaged: { label: 'Triada', variant: 'info' },
  completed: { label: 'Concluída', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'danger' },
}

const REASON_LABELS: Record<string, string> = {
  general: 'Avulsa',
  termination: 'Desligamento',
  work_site_closure: 'Fim de obra',
  exchange: 'Troca',
}

const STATUS_FILTERS = [
  { value: 'open', label: 'Em andamento' },
  { value: 'all', label: 'Todas' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'awaiting_triage', label: 'Aguardando triagem' },
  { value: 'triaged', label: 'Triadas' },
  { value: 'completed', label: 'Concluídas' },
  { value: 'cancelled', label: 'Canceladas' },
]

export function ReturnsPage() {
  const navigate = useNavigate()
  const [returns, setReturns] = useState<ReturnListItem[]>([])
  const [statusFilter, setStatusFilter] = useState('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReturns = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('stock_returns')
      .select(`
        *,
        source_person:people!stock_returns_source_person_id_fkey(id, full_name),
        source_work_site:work_sites!stock_returns_source_work_site_id_fkey(id, name),
        stock_return_items(quantity)
      `)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as unknown as (StockReturnRow & {
      source_person: ReturnListItem['source_person']
      source_work_site: ReturnListItem['source_work_site']
      stock_return_items: { quantity: number }[]
    })[]

    setReturns(
      rows.map((row) => ({
        ...row,
        item_count: row.stock_return_items?.length ?? 0,
        total_quantity: (row.stock_return_items ?? []).reduce((sum, item) => sum + item.quantity, 0),
      })),
    )
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchReturns()
  }, [fetchReturns])

  const visibleReturns = useMemo(() => {
    if (statusFilter === 'all') return returns
    if (statusFilter === 'open') {
      return returns.filter((row) => row.status !== 'completed' && row.status !== 'cancelled')
    }
    return returns.filter((row) => row.status === statusFilter)
  }, [returns, statusFilter])

  const awaitingTriageCount = useMemo(
    () => returns.filter((row) => row.status === 'awaiting_triage').length,
    [returns],
  )
  const triagedCount = useMemo(() => returns.filter((row) => row.status === 'triaged').length, [returns])

  const columns = [
    {
      key: 'code',
      header: 'Código',
      render: (_value: unknown, row: ReturnTableRow) => (
        <div className="flex flex-col">
          <span className="font-mono text-sm text-white">{row.code ?? 'Rascunho'}</span>
          <span className="text-xs text-gray-500">{formatDateTime(row.created_at)}</span>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Origem',
      render: (_value: unknown, row: ReturnTableRow) => (
        <div className="flex flex-col">
          <span className="text-sm text-white">
            {row.source_label_snapshot ?? row.source_person?.full_name ?? row.source_work_site?.name ?? '-'}
          </span>
          <span className="text-xs text-gray-500">
            {row.source_type === 'collaborator' ? 'Colaborador' : 'Obra'}
          </span>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Motivo',
      render: (_value: unknown, row: ReturnTableRow) => (
        <span className="text-sm text-gray-300">{REASON_LABELS[row.reason] ?? row.reason}</span>
      ),
    },
    {
      key: 'items',
      header: 'Itens',
      render: (_value: unknown, row: ReturnTableRow) => (
        <span className="text-sm text-gray-300">
          {row.item_count} item(ns) · {row.total_quantity} un
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Situação',
      render: (_value: unknown, row: ReturnTableRow) => (
        <Badge variant={STATUS_META[row.status].variant} size="sm">
          {STATUS_META[row.status].label}
        </Badge>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Devoluções</h1>
          <p className="mt-1 text-sm text-gray-400">
            Recebimento, triagem e retorno de material ao estoque.
          </p>
        </div>
        <Button onClick={() => navigate('/returns/new')}>Nova devolução</Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="grid gap-2 md:grid-cols-2">
        <Card className="border border-amber-500/10 bg-amber-500/5" variant="bordered">
          <p className="text-xs uppercase tracking-[0.24em] text-amber-200/70">Aguardando triagem</p>
          <p className="mt-1 text-xl font-semibold text-white">{awaitingTriageCount}</p>
          <p className="mt-0.5 text-xs text-gray-400">Material recebido, ainda não classificado.</p>
        </Card>
        <Card className="border border-sky-500/10 bg-sky-500/5" variant="bordered">
          <p className="text-xs uppercase tracking-[0.24em] text-sky-200/70">Prontas para confirmar</p>
          <p className="mt-1 text-xl font-semibold text-white">{triagedCount}</p>
          <p className="mt-0.5 text-xs text-gray-400">Triadas, aguardando entrada no estoque.</p>
        </Card>
      </div>

      <div className="max-w-xs">
        <Select
          label="Situação"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          options={STATUS_FILTERS}
        />
      </div>

      {visibleReturns.length === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-10 w-10" />}
          title="Nenhuma devolução nesta situação"
          description="Registre uma nova devolução para começar."
          action={{ label: 'Nova devolução', onClick: () => navigate('/returns/new') }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={visibleReturns as ReturnTableRow[]}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => navigate(`/returns/${row.id}`)}
        />
      )}
    </div>
  )
}
