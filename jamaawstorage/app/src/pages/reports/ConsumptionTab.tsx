import { useEffect, useMemo, useState } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { cn, openPrintTableDocument } from '../../lib/utils'
import { Alert, Button, DataTable, EmptyState, SectionLabel, Spinner } from '../../components/ui'
import { PackageIcon } from '../../components/icons'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  CHART_BLAZE,
  CHART_GRID,
  chartTickStyle,
  chartTickStyleSmall,
  chartTooltipStyle,
} from './chartTheme'
import {
  CONSUMPTION_WINDOW_DAYS,
  computeConsumption,
  forecastLabel,
  formatRate,
  type ItemConsumption,
} from './consumption'

type StockItemRow = Tables<'stock_items'>
type MovementRow = Tables<'stock_movement_events'>

type MovementSlice = Pick<
  MovementRow,
  'stock_item_id' | 'event_kind' | 'quantity_delta' | 'created_at'
>

const consumptionCache = {
  items: [] as StockItemRow[],
  movements: [] as MovementSlice[],
}

type ConsumptionRow = ItemConsumption & Record<string, unknown>

/* Recharts recebe a margem como numero, entao a largura vem do JS. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  )

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return narrow
}

export function ConsumptionTab() {
  const isNarrow = useIsNarrow()
  const [items, setItems] = useState<StockItemRow[]>(consumptionCache.items)
  const [movements, setMovements] = useState<MovementSlice[]>(
    consumptionCache.movements,
  )
  const [loading, setLoading] = useState(consumptionCache.items.length === 0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      if (consumptionCache.items.length === 0) {
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
        supabase
          .from('stock_movement_events')
          .select('stock_item_id, event_kind, quantity_delta, created_at')
          .in('event_kind', ['exit', 'return', 'restoration'])
          .gte('created_at', since.toISOString()),
      ])

      if (itemsResult.error || movementsResult.error) {
        setError(
          itemsResult.error?.message ?? movementsResult.error?.message ?? null,
        )
        setItems([])
        setMovements([])
      } else {
        consumptionCache.items = (itemsResult.data as StockItemRow[] | null) ?? []
        consumptionCache.movements =
          (movementsResult.data as MovementSlice[] | null) ?? []
        setItems(consumptionCache.items)
        setMovements(consumptionCache.movements)
      }

      setLoading(false)
    }

    void fetchData()
  }, [])

  const rows = useMemo(
    () => computeConsumption(items, movements),
    [items, movements],
  )

  /*
   * Consumivel e circulante ficam separados porque a pergunta util difere.
   * Para consumivel: quando acaba. Para o que circula: quanto esta em campo.
   * O corte vem da taxa de devolucao medida, nao de uma lista fixa de itens.
   */
  const consumable = useMemo(
    () =>
      rows
        .filter((row) => row.nature === 'consumable' && row.netConsumption > 0)
        .sort((a, b) => b.netConsumption - a.netConsumption),
    [rows],
  )

  const circulating = useMemo(
    () =>
      rows
        .filter((row) => row.nature === 'circulating')
        .sort((a, b) => b.grossOut - a.grossOut),
    [rows],
  )

  const chartData = useMemo(() => {
    /* O eixo e mais estreito no telefone, entao o rotulo corta antes. */
    const maxLabel = isNarrow ? 13 : 18
    return consumable.slice(0, 10).map((row) => ({
      name:
        row.name.length > maxLabel
          ? `${row.name.slice(0, maxLabel - 1)}…`
          : row.name,
      fullName: row.name,
      Consumo: row.netConsumption,
    }))
  }, [consumable, isNarrow])

  const consumableColumns = useMemo(
    () => [
      {
        key: 'name' as const,
        header: 'Item',
        sortable: true,
        mobile: 'lead' as const,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="font-medium text-ink">{row.name}</span>
        ),
      },
      {
        key: 'netConsumption' as const,
        header: `Saida liquida (${CONSUMPTION_WINDOW_DAYS}d)`,
        className: 'text-right',
        sortable: true,
        mobile: 'trail' as const,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ink">
            {row.netConsumption} {row.unit}
          </span>
        ),
      },
      {
        key: 'perWeek' as const,
        header: 'Ritmo',
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ink-dim">{formatRate(row)}</span>
        ),
      },
      {
        key: 'distinctDays' as const,
        header: 'Dias com saida',
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ink-dim">{row.distinctDays}</span>
        ),
      },
      {
        key: 'currentQuantity' as const,
        header: 'Saldo',
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ink">
            {row.currentQuantity}
            <span className="text-ink-mute">/{row.minimumQuantity}</span>
          </span>
        ),
      },
      {
        key: 'daysToMinimum' as const,
        header: 'Previsao',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ConsumptionRow) => {
          const hasDate = row.quality === 'reliable'
          return (
            <span
              className={cn(
                'text-sm',
                hasDate
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
    ],
    [],
  )

  const circulatingColumns = useMemo(
    () => [
      {
        key: 'name' as const,
        header: 'Item',
        sortable: true,
        mobile: 'lead' as const,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="font-medium text-ink">{row.name}</span>
        ),
      },
      {
        key: 'grossOut' as const,
        header: 'Saiu',
        className: 'text-right',
        sortable: true,
        mobile: 'trail' as const,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ink">{row.grossOut}</span>
        ),
      },
      {
        key: 'returned' as const,
        header: 'Voltou',
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ok">{row.returned}</span>
        ),
      },
      {
        key: 'returnRatio' as const,
        header: 'Taxa de volta',
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ink-dim">
            {Math.round(row.returnRatio * 100)}%
          </span>
        ),
      },
      {
        key: 'currentQuantity' as const,
        header: 'No estoque',
        className: 'text-right',
        sortable: true,
        mobile: 'meta' as const,
        mobileLabel: true,
        render: (_v: unknown, row: ConsumptionRow) => (
          <span className="num text-ink">{row.currentQuantity}</span>
        ),
      },
    ],
    [],
  )

  const handleExportPDF = () => {
    void openPrintTableDocument({
      title: 'Consumo por item',
      subtitle: `Saida liquida dos ultimos ${CONSUMPTION_WINDOW_DAYS} dias`,
      filename: 'consumo-por-item',
      orientation: 'landscape',
      columns: [
        { key: 'Item', label: 'Item' },
        { key: 'Saida', label: 'Saida liquida' },
        { key: 'Ritmo', label: 'Ritmo' },
        { key: 'Dias', label: 'Dias com saida' },
        { key: 'Saldo', label: 'Saldo' },
        { key: 'Minimo', label: 'Minimo' },
        { key: 'Previsao', label: 'Previsao' },
      ],
      rows: consumable.map((row) => ({
        Item: row.name,
        Saida: `${row.netConsumption} ${row.unit}`,
        Ritmo: formatRate(row),
        Dias: row.distinctDays,
        Saldo: row.currentQuantity,
        Minimo: row.minimumQuantity,
        Previsao: forecastLabel(row),
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

  if (consumable.length === 0 && circulating.length === 0) {
    return (
      <EmptyState
        icon={<PackageIcon size={40} />}
        title="Sem movimentacao no periodo"
        description={`Nenhuma saida registrada nos ultimos ${CONSUMPTION_WINDOW_DAYS} dias.`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {chartData.length > 0 && (
        <div className="border border-line bg-surface p-4">
          <SectionLabel label={`Maior saida liquida em ${CONSUMPTION_WINDOW_DAYS} dias`} />
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 20, left: isNarrow ? 0 : 110, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis type="number" tick={chartTickStyle} />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={chartTickStyleSmall}
                  width={isNarrow ? 88 : 100}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={((value: unknown) => [String(value), 'Saida liquida'])}
                  labelFormatter={((
                    label: unknown,
                    payload: readonly { payload?: { fullName?: unknown } }[] | undefined,
                  ) => {
                    const fullName = payload?.[0]?.payload?.fullName
                    if (typeof fullName === 'string') return fullName
                    return String(label)
                  })}
                  cursor={{ fill: CHART_GRID }}
                />
                <Bar dataKey="Consumo" fill={CHART_BLAZE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SectionLabel
            className="mb-0"
            label="Consumivel"
            info={`Itens que praticamente nao voltam ao estoque (menos de 5% de devolucao). A saida liquida desconta o que voltou pela triagem. A previsao usa a media dos ultimos ${CONSUMPTION_WINDOW_DAYS} dias e so aparece como data quando o historico sustenta.`}
          />
          {consumable.length > 0 && (
            <Button variant="secondary" size="sm" onClick={handleExportPDF}>
              Exportar PDF
            </Button>
          )}
        </div>
        {consumable.length === 0 ? (
          <p className="border border-line p-4 text-sm text-ink-dim">
            Nenhum item consumivel com saida no periodo.
          </p>
        ) : (
          <DataTable<ConsumptionRow>
            columns={consumableColumns}
            data={consumable as ConsumptionRow[]}
            keyExtractor={(row) => row.itemId}
            emptyMessage="Nenhum item"
          />
        )}
      </div>

      {circulating.length > 0 && (
        <div>
          <SectionLabel
            label="Em circulacao"
            info="Itens que saem e voltam, como ferramenta e EPI duravel. Nao recebem previsao de ruptura: a saida nao consome a unidade, ela retorna pela triagem."
          />
          <DataTable<ConsumptionRow>
            columns={circulatingColumns}
            data={circulating as ConsumptionRow[]}
            keyExtractor={(row) => row.itemId}
            emptyMessage="Nenhum item"
          />
        </div>
      )}
    </div>
  )
}
