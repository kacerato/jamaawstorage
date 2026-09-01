import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { StockReturnStatus, Tables } from '../../types/database'
import { formatDateTime } from '../../lib/utils'
import { Alert, Badge, Button, Card, DataTable, EmptyState, Spinner } from '../../components/ui'
import { PackageIcon } from '../../components/icons'

type StockReturnRow = Tables<'stock_returns'>

interface ReturnSummary extends StockReturnRow {
  source_person: { id: string; full_name: string } | null
  source_work_site: { id: string; name: string } | null
  item_count: number
}

type ReturnTableRow = ReturnSummary & Record<string, unknown>

interface StockReturnsTabProps {
  profileId: string | null
  embedded?: boolean
}

const STATUS_META: Record<StockReturnStatus, { label: string; variant: 'default' | 'warning' | 'info' | 'success' | 'danger' }> = {
  draft: { label: 'Rascunho', variant: 'default' },
  awaiting_triage: { label: 'Aguardando triagem', variant: 'warning' },
  triaged: { label: 'Triada', variant: 'info' },
  completed: { label: 'Concluída', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'danger' },
}

/**
 * Resumo das devoluções em aberto dentro da tela de estoque. O fluxo completo
 * (seleção, termo, triagem e confirmação) vive em /returns, porque cada etapa
 * precisa de uma tela própria em vez de um modal.
 */
export function StockReturnsTab({ embedded = false }: StockReturnsTabProps) {
  const navigate = useNavigate()
  const [returns, setReturns] = useState<ReturnSummary[]>([])
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
        stock_return_items(id)
      `)
      .order('created_at', { ascending: false })
      .limit(50)

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as unknown as (StockReturnRow & {
      source_person: ReturnSummary['source_person']
      source_work_site: ReturnSummary['source_work_site']
      stock_return_items: { id: string }[]
    })[]

    setReturns(rows.map((row) => ({ ...row, item_count: row.stock_return_items?.length ?? 0 })))
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchReturns()
  }, [fetchReturns])

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
        <span className="text-sm text-white">
          {row.source_label_snapshot ?? row.source_person?.full_name ?? row.source_work_site?.name ?? '-'}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Itens',
      render: (_value: unknown, row: ReturnTableRow) => (
        <span className="text-sm text-gray-300">{row.item_count}</span>
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
      <div className="flex min-h-[280px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <div>
          <h2 className="text-2xl font-bold text-white">Itens devolvidos ao almoxarifado</h2>
          <p className="mt-1 text-sm text-gray-400">
            Receba o material, classifique na triagem e confirme a entrada no estoque.
          </p>
        </div>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-2 sm:grid-cols-2">
          <Card className="border border-amber-500/10 bg-amber-500/5" variant="bordered">
            <p className="text-xs uppercase tracking-[0.24em] text-amber-200/70">Aguardando triagem</p>
            <p className="mt-1 text-xl font-semibold text-white">{awaitingTriageCount}</p>
          </Card>
          <Card className="border border-sky-500/10 bg-sky-500/5" variant="bordered">
            <p className="text-xs uppercase tracking-[0.24em] text-sky-200/70">Prontas para confirmar</p>
            <p className="mt-1 text-xl font-semibold text-white">{triagedCount}</p>
          </Card>
        </div>
        <Button onClick={() => navigate('/returns/new')}>Nova devolução</Button>
      </div>

      {returns.length === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-10 w-10" />}
          title="Nenhuma devolução registrada"
          description="Registre uma devolução para conferir e devolver material ao estoque."
          action={{ label: 'Nova devolução', onClick: () => navigate('/returns/new') }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={returns as ReturnTableRow[]}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => navigate(`/returns/${row.id}`)}
        />
      )}
    </div>
  )
}
