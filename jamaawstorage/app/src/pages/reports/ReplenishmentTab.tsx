import { useEffect, useMemo, useState } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { cn, openPrintTableDocument } from '../../lib/utils'
import { Alert, Button, DataTable, EmptyState, SectionLabel, Spinner } from '../../components/ui'
import { AlertIcon, PackageIcon } from '../../components/icons'
import {
  CONSUMPTION_WINDOW_DAYS,
  computeConsumption,
  forecastLabel,
  formatRate,
  replenishmentList,
  summarize,
  type ItemConsumption,
  type StockStatus,
} from './consumption'

type StockItemRow = Tables<'stock_items'>
type MovementRow = Tables<'stock_movement_events'>

type MovementSlice = Pick<
  MovementRow,
  'stock_item_id' | 'event_kind' | 'quantity_delta' | 'created_at'
>

const replenishmentCache = {
  items: [] as StockItemRow[],
  movements: [] as MovementSlice[],
}

/* Severidade pela faixa lateral, nunca por fundo tingido. */
const STATUS_ACCENT: Record<StockStatus, string> = {
  out: 'border-l-crit',
  'below-minimum': 'border-l-crit',
  'approaching-minimum': 'border-l-warn',
  ok: 'border-l-line',
}

const STATUS_TEXT: Record<StockStatus, string> = {
  out: 'Sem saldo',
  'below-minimum': 'Abaixo do minimo',
  'approaching-minimum': 'Perto do minimo',
  ok: 'Normal',
}

type ReplenishmentRow = ItemConsumption & Record<string, unknown>

function MetricBlock({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'warn' | 'crit' | 'ok'
}) {
  /* O estado tinge o numero, nao a caixa. */
  const toneClass =
    tone === 'crit'
      ? 'text-crit'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'ok'
          ? 'text-ok'
          : 'text-ink'

  return (
    <div className="flex min-w-0 flex-col gap-2 p-4">
      <p className="label-mono">{label}</p>
      <p className={cn('num text-2xl leading-none', toneClass)}>{value}</p>
    </div>
  )
}

export function ReplenishmentTab() {
  const [items, setItems] = useState<StockItemRow[]>(replenishmentCache.items)
  const [movements, setMovements] = useState<MovementSlice[]>(
    replenishmentCache.movements,
  )
  const [loading, setLoading] = useState(replenishmentCache.items.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    async function fetchData() {
      if (replenishmentCache.items.length === 0) {
        setLoading(true)
      }
      setError(null)

      const since = new Date()
      since.setDate(since.getDate() - CONSUMPTION_WINDOW_DAYS)

      const [itemsResult, movementsResult] = await Promise.all([
        supabase
          .from('stock_items')
          .select('*')
          .eq('is_active', true)
          .order('name'),
        /*
         * So os tipos que mexem no saldo. `received`, `triage` e
         * `reclassification` tem delta zero por construcao, porque o estoque
         * e creditado apenas no fim da triagem.
         */
        supabase
          .from('stock_movement_events')
          .select('stock_item_id, event_kind, quantity_delta, created_at')
          .in('event_kind', ['exit', 'return', 'restoration'])
          .gte('created_at', since.toISOString()),
      ])

      if (itemsResult.error || movementsResult.error) {
        setError(itemsResult.error?.message ?? movementsResult.error?.message ?? null)
        setItems([])
        setMovements([])
      } else {
        replenishmentCache.items = (itemsResult.data as StockItemRow[] | null) ?? []
        replenishmentCache.movements =
          (movementsResult.data as MovementSlice[] | null) ?? []
        setItems(replenishmentCache.items)
        setMovements(replenishmentCache.movements)
      }

      setLoading(false)
    }

    void fetchData()
  }, [])

  const rows = useMemo(
    () => computeConsumption(items, movements),
    [items, movements],
  )

  const needsAttention = useMemo(() => replenishmentList(rows), [rows])
  const summary = useMemo(() => summarize(rows), [rows])

  const visibleRows = useMemo(
    () => (showAll ? needsAttention : needsAttention.slice(0, 10)),
    [needsAttention, showAll],
  )

  const tableData = useMemo(
    () => visibleRows as ReplenishmentRow[],
    [visibleRows],
  )

  const columns = useMemo(
    () => [
      {
        key: 'name' as const,
        header: 'Item',
        sortable: true,
        mobile: 'lead' as const,
        render: (_v: unknown, row: ReplenishmentRow) => (
          <div
            className={cn(
              'flex flex-col gap-0.5 border-l-2 pl-3',
              /*
               * Item que circula nao e critico por estar no minimo: a unidade
               * esta em campo e volta pela triagem. Faixa neutra para nao
               * disputar atencao com o que falta de verdade.
               */
              row.nature === 'circulating'
                ? 'border-l-line'
                : STATUS_ACCENT[row.status],
            )}
          >
            <span className="font-medium text-ink">{row.name}</span>
            <span className="text-xs text-ink-mute">
              {row.category ?? 'Sem categoria'}
            </span>
          </div>
        ),
      },
      {
        key: 'currentQuantity' as const,
        header: 'Saldo',
        className: 'text-right',
        sortable: true,
        mobile: 'trail' as const,
        render: (_v: unknown, row: ReplenishmentRow) => (
          <span className="num text-ink">
            {row.currentQuantity}
            <span className="text-ink-mute">/{row.minimumQuantity}</span>
          </span>
        ),
      },
      {
        key: 'perWeek' as const,
        header: `Consumo (${CONSUMPTION_WINDOW_DAYS}d)`,
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ReplenishmentRow) => (
          <span className="num text-ink-dim">{formatRate(row)}</span>
        ),
      },
      {
        key: 'daysToMinimum' as const,
        header: 'Previsao',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ReplenishmentRow) => {
          /*
           * A cor segue o estado, nao a existencia de data: sem saldo e abaixo
           * do minimo sao criticos agora. Entre os demais, so a previsao com
           * data recebe destaque; os outros textos explicam a ausencia dela e
           * nao devem competir.
           */
          const isCritical =
            row.status === 'out' || row.status === 'below-minimum'
          const hasDate =
            row.quality === 'reliable' && row.nature === 'consumable'

          return (
            <span
              className={cn(
                'text-sm',
                isCritical
                  ? 'text-crit'
                  : hasDate
                    ? row.status === 'approaching-minimum'
                      ? 'text-warn'
                      : 'text-ink'
                    : 'text-ink-mute',
              )}
            >
              {forecastLabel(row)}
            </span>
          )
        },
      },
      {
        key: 'suggestedPurchase' as const,
        header: 'Comprar',
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ReplenishmentRow) =>
          row.suggestedPurchase === null || row.suggestedPurchase === 0 ? (
            <span className="text-ink-mute">—</span>
          ) : (
            <span className="num text-ink">
              {row.suggestedPurchase} {row.unit}
            </span>
          ),
      },
    ],
    [],
  )

  const handleExportPDF = () => {
    if (needsAttention.length === 0) return

    void openPrintTableDocument({
      title: 'Reposicao de estoque',
      subtitle: `Consumo medido em ${CONSUMPTION_WINDOW_DAYS} dias`,
      filename: 'reposicao-estoque',
      orientation: 'landscape',
      columns: [
        { key: 'Item', label: 'Item' },
        { key: 'Saldo', label: 'Saldo' },
        { key: 'Minimo', label: 'Minimo' },
        { key: 'Situacao', label: 'Situacao' },
        { key: 'Consumo', label: 'Consumo' },
        { key: 'Previsao', label: 'Previsao' },
        { key: 'Comprar', label: 'Comprar' },
      ],
      rows: needsAttention.map((row) => ({
        Item: row.name,
        Saldo: row.currentQuantity,
        Minimo: row.minimumQuantity,
        Situacao: STATUS_TEXT[row.status],
        Consumo: formatRate(row),
        Previsao: forecastLabel(row),
        Comprar: row.suggestedPurchase ?? '-',
      })),
    })
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return <Alert variant="danger">{error}</Alert>
  }

  /*
   * So conta quem de fato pede compra: consumivel em falta ou abaixo do
   * minimo. Item que circula fica de fora, porque repor depende do que esta
   * em campo e nao de comprar mais.
   */
  const buyNow = needsAttention.filter(
    (row) =>
      row.nature === 'consumable' &&
      (row.status === 'out' || row.status === 'below-minimum'),
  )
  const criticalCount = buyNow.length

  return (
    <div className="flex flex-col gap-6">
      {/* Uma superficie so: as divisoes internas sao linha, nao segundo fundo. */}
      <div className="grid grid-cols-2 divide-x divide-y divide-line border border-line bg-surface sm:grid-cols-4 sm:divide-y-0">
        <MetricBlock
          label="Sem saldo"
          value={summary.outCount}
          tone={summary.outCount > 0 ? 'crit' : 'default'}
        />
        <MetricBlock
          label="Abaixo do minimo"
          value={summary.belowMinimumCount}
          tone={summary.belowMinimumCount > 0 ? 'crit' : 'default'}
        />
        <MetricBlock
          label="Perto do minimo"
          value={summary.approachingCount}
          tone={summary.approachingCount > 0 ? 'warn' : 'default'}
        />
        <MetricBlock
          label={`Consumo ${CONSUMPTION_WINDOW_DAYS}d`}
          value={summary.totalNetConsumption}
        />
      </div>

      {criticalCount > 0 && (
        <div className="border-l-2 border-l-crit bg-void p-4">
          <p className="text-sm text-ink">
            {criticalCount === 1
              ? '1 item precisa de compra agora.'
              : `${criticalCount} itens precisam de compra agora.`}{' '}
            <span className="text-ink-dim">
              {summary.approachingCount > 0
                ? `Outros ${summary.approachingCount} cruzam o minimo em menos de 30 dias.`
                : 'Nenhum outro item cruza o minimo em menos de 30 dias.'}
            </span>
          </p>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SectionLabel
            className="mb-0"
            label="Reposicao"
            info={`Itens sem saldo, abaixo do minimo ou que cruzam o minimo em ate 30 dias. O consumo e a saida liquida dos ultimos ${CONSUMPTION_WINDOW_DAYS} dias, descontando o que voltou pela triagem.`}
          />
          {needsAttention.length > 0 && (
            <Button variant="secondary" size="sm" onClick={handleExportPDF}>
              Exportar PDF
            </Button>
          )}
        </div>

        {needsAttention.length === 0 ? (
          <EmptyState
            icon={<PackageIcon size={40} />}
            title="Nenhum item em alerta"
            description="Todos os itens estao acima do minimo e nenhum cruza o limite nos proximos 30 dias."
          />
        ) : (
          <>
            <DataTable<ReplenishmentRow>
              columns={columns}
              data={tableData}
              keyExtractor={(row) => row.itemId}
              emptyMessage="Nenhum item em alerta"
            />
            {needsAttention.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="mt-2 min-h-touch w-full border border-line px-4 text-sm text-ink-dim transition-colors hover:bg-surface hover:text-ink"
              >
                {showAll
                  ? 'Mostrar apenas os 10 primeiros'
                  : `Ver todos os ${needsAttention.length} itens`}
              </button>
            )}
          </>
        )}
      </div>

      {summary.weakCount > 0 && (
        <div className="flex items-start gap-3 border border-line p-4">
          <span className="mt-0.5 flex-shrink-0 text-ink-mute">
            <AlertIcon size={16} />
          </span>
          <p className="text-sm text-ink-dim">
            {summary.weakCount}{' '}
            {summary.weakCount === 1 ? 'item tem' : 'itens tem'} historico curto,
            irregular ou parado, entao a previsao mostra o motivo em vez de uma
            data. {summary.trackedCount}{' '}
            {summary.trackedCount === 1 ? 'item tem' : 'itens tem'} consumo
            regular o bastante para projetar ruptura.
          </p>
        </div>
      )}
    </div>
  )
}
