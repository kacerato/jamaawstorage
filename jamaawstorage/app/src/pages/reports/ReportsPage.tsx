import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Tables } from '../../types/database'
import type { DateRange, ReportPeriod } from '../../types'
import { supabase } from '../../lib/supabase'
import { cn, formatDateTime, openPrintSectionedTableDocument, openPrintTableDocument } from '../../lib/utils'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  Button,
  Input,
  Select,
  Card,
  Badge,
  DataTable,
  Alert,
  EmptyState,
  StatCard,
  Spinner,
} from '../../components/ui'
import { ChartIcon, ClipboardIcon, PackageIcon, UsersIcon, AlertIcon } from '../../components/icons'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

type PersonRow = Tables<'people'>
type StockItemRow = Tables<'stock_items'>
type WorkSiteRow = Tables<'work_sites'>

type TabKey =
  | 'movements'
  | 'inventory'
  | 'stock'
  | 'abc'
  | 'lowstock'
  | 'leader'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'movements', label: 'Movimentacoes por Periodo' },
  { key: 'inventory', label: 'Inventario de Colaboradores' },
  { key: 'stock', label: 'Estoque Geral' },
  { key: 'abc', label: 'Curva ABC de Saida' },
  { key: 'lowstock', label: 'Itens Abaixo do Minimo' },
  { key: 'leader', label: 'Consumo por Solicitante' },
]

const PERIOD_PRESETS: { value: ReportPeriod; label: string }[] = [
  { value: 'week', label: 'Ultima Semana' },
  { value: 'month', label: 'Ultimo Mes' },
  { value: 'quarter', label: 'Ultimos 3 Meses' },
  { value: 'custom', label: 'Customizado' },
]

function getDateRange(period: ReportPeriod): DateRange {
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  const from = new Date()
  from.setHours(0, 0, 0, 0)

  switch (period) {
    case 'week':
      from.setDate(from.getDate() - 7)
      break
    case 'month':
      from.setMonth(from.getMonth() - 1)
      break
    case 'quarter':
      from.setMonth(from.getMonth() - 3)
      break
  }

  return { from, to }
}

interface WithdrawalWithItems extends Tables<'withdrawals'> {
  withdrawal_items: (Tables<'withdrawal_items'> & {
    stock_items: StockItemRow
  })[]
  requested_by_person: PersonRow
  collaborator: PersonRow | null
  work_site: WorkSiteRow | null
}

interface CollaboratorWithInventory extends PersonRow {
  person_inventories: (Tables<'person_inventories'> & {
    stock_items: StockItemRow
  })[]
}

interface AbcItem {
  name: string
  totalQuantity: number
  percentage: number
  cumulativePercentage: number
  classification: 'A' | 'B' | 'C'
}

interface LowStockItem extends StockItemRow {
  deficit: number
  severity: 'critical' | 'warning'
}

interface LeaderConsumptionItem {
  name: string
  quantity: number
}

interface LeaderConsumptionSection {
  leaderId: string
  leaderName: string
  items: LeaderConsumptionItem[]
  totalItems: number
  totalWithdrawals: number
}

const JOB_TITLE_FILTER_OPTIONS = [
  { value: '', label: 'Todas as funcoes' },
  { value: 'cabista', label: 'Cabista' },
  { value: 'ajudante de cabista', label: 'Ajudante de cabista' },
]

const reportsCache = {
  movements: {
    withdrawals: [] as WithdrawalWithItems[],
    leaders: [] as PersonRow[],
    worksites: [] as WorkSiteRow[],
    stockItems: [] as StockItemRow[],
  },
  inventory: {
    collaborators: [] as CollaboratorWithInventory[],
  },
  stock: {
    items: [] as StockItemRow[],
  },
  abc: {
    items: [] as AbcItem[],
  },
  lowStock: {
    items: [] as LowStockItem[],
  },
  leader: {
    leaders: [] as PersonRow[],
    consumptionData: [] as LeaderConsumptionItem[],
    sections: [] as LeaderConsumptionSection[],
    totalItems: 0,
    totalWithdrawals: 0,
  },
}

function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return

  const headers = Object.keys(data[0])
  const csvRows: string[] = [headers.join(';')]

  for (const row of data) {
    const values = headers.map((header) => {
      const val = row[header]
      if (val === null || val === undefined) return ''
      const str = String(val)
      if (str.includes(';') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    })
    csvRows.push(values.join(';'))
  }

  const csvString = '\uFEFF' + csvRows.join('\n')
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function exportToPDF(
  data: Record<string, unknown>[],
  title: string,
  subtitle: string,
  filename: string,
  options?: {
    orientation?: 'portrait' | 'landscape'
    compact?: boolean
  },
) {
  if (data.length === 0) return

  openPrintTableDocument({
    title,
    subtitle,
    filename,
    orientation: options?.orientation,
    compact: options?.compact,
    columns: Object.keys(data[0]).map((key) => ({
      key,
      label: key,
    })),
    rows: data,
  })
}

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('movements')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Relatorios</h2>
        <p className="mt-1 text-sm text-gray-400">
          Relatorios de retiradas, consumo e estoque
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-gray-900 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-orange-500 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'movements' && <MovementsTab />}
      {activeTab === 'inventory' && <InventoryTab />}
      {activeTab === 'stock' && <StockOverviewTab />}
      {activeTab === 'abc' && <AbcCurveTab />}
      {activeTab === 'lowstock' && <LowStockTab />}
      {activeTab === 'leader' && <LeaderConsumptionTab />}
    </div>
  )
}

function MovementsTab() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalWithItems[]>(reportsCache.movements.withdrawals)
  const [leaders, setLeaders] = useState<PersonRow[]>(reportsCache.movements.leaders)
  const [worksites, setWorksites] = useState<WorkSiteRow[]>(reportsCache.movements.worksites)
  const [stockItems, setStockItems] = useState<StockItemRow[]>(reportsCache.movements.stockItems)
  const [loading, setLoading] = useState(reportsCache.movements.withdrawals.length === 0)
  const [error, setError] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [leaderFilter, setLeaderFilter] = useState<string>('')
  const [jobTitleFilter, setJobTitleFilter] = useState<string>('')
  const [worksiteFilter, setWorksiteFilter] = useState<string>('')
  const [itemFilter, setItemFilter] = useState<string>('')
  const debouncedDateFrom = useDebouncedValue(dateFrom, 180)
  const debouncedDateTo = useDebouncedValue(dateTo, 180)
  const debouncedLeaderFilter = useDebouncedValue(leaderFilter, 180)
  const debouncedJobTitleFilter = useDebouncedValue(jobTitleFilter, 180)
  const debouncedWorksiteFilter = useDebouncedValue(worksiteFilter, 180)
  const debouncedItemFilter = useDebouncedValue(itemFilter, 180)

  useEffect(() => {
    async function fetchFilters() {
      const [leadersRes, worksitesRes, itemsRes] = await Promise.all([
        supabase.from('people').select('*').eq('is_active', true).in('role', ['leader', 'supervisor']).order('full_name'),
        supabase.from('work_sites').select('*').eq('is_active', true).order('name'),
        supabase.from('stock_items').select('*').order('name'),
      ])

      if (leadersRes.data) {
        reportsCache.movements.leaders = leadersRes.data as PersonRow[]
        setLeaders(reportsCache.movements.leaders)
      }
      if (worksitesRes.data) {
        reportsCache.movements.worksites = worksitesRes.data as WorkSiteRow[]
        setWorksites(reportsCache.movements.worksites)
      }
      if (itemsRes.data) {
        reportsCache.movements.stockItems = itemsRes.data as StockItemRow[]
        setStockItems(reportsCache.movements.stockItems)
      }
    }
    void fetchFilters()
  }, [])

  const fetchWithdrawals = useCallback(async () => {
    if (reportsCache.movements.withdrawals.length === 0) {
      setLoading(true)
    }
    setError(null)

    let query = supabase
      .from('withdrawals')
      .select(
        '*, withdrawal_items(*, stock_items(*)), requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*)',
      )
      .in('status', ['approved', 'completed'])
      .order('created_at', { ascending: false })

    if (debouncedDateFrom) {
      query = query.gte('created_at', debouncedDateFrom)
    }
    if (debouncedDateTo) {
      query = query.lte('created_at', `${debouncedDateTo}T23:59:59`)
    }
    if (debouncedLeaderFilter) {
      query = query.eq('requested_by', debouncedLeaderFilter)
    }
    if (debouncedWorksiteFilter) {
      query = query.eq('work_site_id', debouncedWorksiteFilter)
    }

    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
      setWithdrawals([])
    } else {
      let results = (data as unknown as WithdrawalWithItems[]) ?? []

      if (debouncedItemFilter) {
        results = results.filter((w) =>
          w.withdrawal_items.some((wi) => wi.stock_item_id === debouncedItemFilter),
        )
      }

      if (debouncedJobTitleFilter) {
        results = results.filter((w) => w.collaborator?.job_title === debouncedJobTitleFilter)
      }

      reportsCache.movements.withdrawals = results
      setWithdrawals(results)
    }
    setLoading(false)
  }, [
    debouncedDateFrom,
    debouncedDateTo,
    debouncedLeaderFilter,
    debouncedJobTitleFilter,
    debouncedWorksiteFilter,
    debouncedItemFilter,
  ])

  useEffect(() => {
    void fetchWithdrawals()
  }, [fetchWithdrawals])

  const leaderOptions = useMemo(
    () => [
      { value: '', label: 'Todos os solicitantes' },
      ...leaders.map((l) => ({ value: l.id, label: l.full_name })),
    ],
    [leaders],
  )

  const worksiteOptions = useMemo(
    () => [
      { value: '', label: 'obra jamaaw' },
      ...worksites.map((w) => ({ value: w.id, label: 'obra jamaaw' })),
    ],
    [worksites],
  )

  const itemOptions = useMemo(
    () => [
      { value: '', label: 'Todos os itens' },
      ...stockItems.map((i) => ({ value: i.id, label: i.name })),
    ],
    [stockItems],
  )

  type WithdrawalRowForTable = WithdrawalWithItems & Record<string, unknown>

  const tableData = useMemo<WithdrawalRowForTable[]>(
    () => withdrawals as WithdrawalRowForTable[],
    [withdrawals],
  )

  const columns = useMemo(
    () => [
      {
        key: 'created_at' as const,
        header: 'Data',
        sortable: true,
        render: (_v: unknown, row: WithdrawalRowForTable) =>
          formatDateTime((row as unknown as WithdrawalWithItems).created_at),
      },
      {
        key: 'code' as const,
        header: 'Codigo',
        sortable: true,
        render: (_v: unknown, row: WithdrawalRowForTable) => (
          <span className="font-mono font-medium text-orange-400">
            {(row as unknown as WithdrawalWithItems).code}
          </span>
        ),
      },
      {
        key: 'requested_by' as const,
        header: 'Solicitante',
        render: (_v: unknown, row: WithdrawalRowForTable) =>
          (row as unknown as WithdrawalWithItems).requested_by_person?.full_name ?? '-',
      },
      {
        key: 'destination_type' as const,
        header: 'Destino',
        render: (_v: unknown, row: WithdrawalRowForTable) => {
          const w = row as unknown as WithdrawalWithItems
          if (w.destination_type === 'collaborator') {
            return w.collaborator?.full_name ?? 'Colaborador'
          }
          return 'obra jamaaw'
        },
      },
      {
        key: 'withdrawal_items' as const,
        header: 'Itens',
        render: (_v: unknown, row: WithdrawalRowForTable) => {
          const items = (row as unknown as WithdrawalWithItems).withdrawal_items
          return (
            <div className="flex flex-col gap-0.5">
              {items.map((wi) => (
                <span key={wi.id} className="text-xs text-gray-400">
                  {wi.stock_items?.name ?? '-'} ({wi.quantity} {wi.unit})
                </span>
              ))}
            </div>
          )
        },
      },
      {
        key: 'totalQty' as const,
        header: 'Qtd Total',
        className: 'text-center',
        render: (_v: unknown, row: WithdrawalRowForTable) => {
          const items = (row as unknown as WithdrawalWithItems).withdrawal_items
          const total = items.reduce((sum, wi) => sum + wi.quantity, 0)
          return <span className="font-medium text-white">{total}</span>
        },
      },
    ],
    [],
  )

  const handleExportCSV = () => {
    const rows = withdrawals.map((w) => ({
      Data: formatDateTime(w.created_at),
      Codigo: w.code,
      Solicitante: w.requested_by_person?.full_name ?? '',
      Destino:
        w.destination_type === 'collaborator'
          ? w.collaborator?.full_name ?? 'Colaborador'
          : 'obra jamaaw',
      Itens: w.withdrawal_items
        .map((wi) => `${wi.stock_items?.name ?? '-'} (${wi.quantity} ${wi.unit})`)
        .join(', '),
      'Qtd Total': w.withdrawal_items.reduce((s, wi) => s + wi.quantity, 0),
    }))
    exportToCSV(rows, 'movimentacoes-periodo.csv')
  }

  const handleExportPDF = () => {
    const rows = withdrawals.map((w) => ({
      Data: formatDateTime(w.created_at),
      Codigo: w.code,
      Solicitante: w.requested_by_person?.full_name ?? '',
      Destino:
        w.destination_type === 'collaborator'
          ? w.collaborator?.full_name ?? 'Colaborador'
          : 'obra jamaaw',
      Itens: w.withdrawal_items
        .map((wi) => `${wi.stock_items?.name ?? '-'} (${wi.quantity} ${wi.unit})`)
        .join(', '),
      'Qtd Total': w.withdrawal_items.reduce((s, wi) => s + wi.quantity, 0),
    }))

    exportToPDF(rows, 'Movimentacoes por Periodo', 'Relatorio consolidado de retiradas filtradas.', 'movimentacoes-periodo.pdf')
  }

  return (
    <div className="flex flex-col gap-4">
      <Card variant="bordered" padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input
              type="date"
              label="De"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Input
              type="date"
              label="Ate"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="w-52">
            <Select
              label="Solicitante"
              options={leaderOptions}
              value={leaderFilter}
              onChange={(e) => setLeaderFilter(e.target.value)}
            />
          </div>
          <div className="w-52">
            <Select
              label="Funcao"
              options={JOB_TITLE_FILTER_OPTIONS}
              value={jobTitleFilter}
              onChange={(e) => setJobTitleFilter(e.target.value)}
            />
          </div>
          <div className="w-48">
            <Select
              label="Obra"
              options={worksiteOptions}
              value={worksiteFilter}
              onChange={(e) => setWorksiteFilter(e.target.value)}
            />
          </div>
          <div className="w-48">
            <Select
              label="Item"
              options={itemOptions}
              value={itemFilter}
              onChange={(e) => setItemFilter(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
                setLeaderFilter('')
                setJobTitleFilter('')
                setWorksiteFilter('')
                setItemFilter('')
              }}
            >
              Limpar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={withdrawals.length === 0}
            >
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={withdrawals.length === 0}
            >
              Exportar PDF
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable<WithdrawalRowForTable>
        columns={columns}
        data={tableData}
        keyExtractor={(row) => (row as unknown as WithdrawalWithItems).id}
        isLoading={loading}
        emptyMessage="Nenhuma movimentacao encontrada para os filtros aplicados"
      />
    </div>
  )
}

function StockOverviewTab() {
  const [stockItems, setStockItems] = useState<StockItemRow[]>(reportsCache.stock.items)
  const [loading, setLoading] = useState(reportsCache.stock.items.length === 0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStockItems() {
      if (reportsCache.stock.items.length === 0) {
        setLoading(true)
      }
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('stock_items')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (fetchError) {
        setError(fetchError.message)
        setStockItems([])
      } else {
        reportsCache.stock.items = (data as StockItemRow[] | null) ?? []
        setStockItems(reportsCache.stock.items)
      }

      setLoading(false)
    }

    void fetchStockItems()
  }, [])

  const stockRows = useMemo(
    () => stockItems.map((item) => ({
      Codigo: item.code,
      Item: item.name,
      Categoria: item.category ?? '',
      Unidade: item.unit,
      'Qtd Atual': item.current_quantity,
      'Qtd Minima': item.minimum_quantity,
      Status: item.current_quantity <= item.minimum_quantity ? 'Abaixo do minimo' : 'OK',
    })),
    [stockItems],
  )

  const tableData = useMemo(
    () => stockItems as (StockItemRow & Record<string, unknown>)[],
    [stockItems],
  )

  const columns = useMemo(
    () => [
      {
        key: 'code' as const,
        header: 'Codigo',
        sortable: true,
        render: (value: unknown) => (
          <span className="font-mono text-orange-400">{value as string}</span>
        ),
      },
      {
        key: 'name' as const,
        header: 'Item',
        sortable: true,
        render: (value: unknown) => <span className="font-medium text-white">{value as string}</span>,
      },
      {
        key: 'category' as const,
        header: 'Categoria',
        sortable: true,
        render: (value: unknown) => (value as string | null) ?? '-',
      },
      {
        key: 'unit' as const,
        header: 'Unidade',
        render: (value: unknown) => value as string,
      },
      {
        key: 'current_quantity' as const,
        header: 'Qtd Atual',
        className: 'text-right',
        render: (_value: unknown, row: StockItemRow & Record<string, unknown>) => {
          const item = row as StockItemRow
          return (
            <span className={cn(
              'inline-block w-[88px] text-right font-medium tabular-nums',
              item.current_quantity <= item.minimum_quantity ? 'text-orange-400' : 'text-white',
            )}
            >
              {item.current_quantity}
            </span>
          )
        },
      },
      {
        key: 'minimum_quantity' as const,
        header: 'Qtd Minima',
        className: 'text-right',
        render: (value: unknown) => (
          <span className="inline-block w-[88px] text-right text-gray-300 tabular-nums">{value as number}</span>
        ),
      },
    ],
    [],
  )

  const handleExportPDF = () => {
    exportToPDF(
      stockRows,
      'Estoque Geral',
      'Panorama completo dos itens ativos do estoque.',
      'estoque-geral.pdf',
      { orientation: 'landscape', compact: true },
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Spinner size="lg" />
        <p className="mt-4 text-sm text-gray-400">Carregando estoque...</p>
      </div>
    )
  }

  if (error) {
    return <Alert variant="danger" title="Erro ao carregar">{error}</Alert>
  }

  if (stockItems.length === 0) {
    return (
      <EmptyState
        icon={<PackageIcon size={48} />}
        title="Sem itens ativos"
        description="Nao ha itens ativos para relatar no estoque."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => exportToCSV(stockRows, 'estoque-geral.csv')}>
          Exportar CSV
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF}>
          Exportar PDF
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard title="Itens Ativos" value={stockItems.length} icon={<PackageIcon size={20} />} />
        <StatCard
          title="Qtd Total"
          value={stockItems.reduce((total, item) => total + item.current_quantity, 0)}
          icon={<ClipboardIcon size={20} />}
        />
        <StatCard
          title="Abaixo do Minimo"
          value={stockItems.filter((item) => item.current_quantity <= item.minimum_quantity).length}
          icon={<AlertIcon size={20} />}
          variant="warning"
        />
      </div>

      <DataTable<StockItemRow & Record<string, unknown>>
        columns={columns}
        data={tableData}
        keyExtractor={(row) => (row as StockItemRow).id}
        isLoading={false}
        emptyMessage="Nenhum item encontrado"
      />
    </div>
  )
}

function InventoryTab() {
  const [collaborators, setCollaborators] = useState<CollaboratorWithInventory[]>(reportsCache.inventory.collaborators)
  const [loading, setLoading] = useState(reportsCache.inventory.collaborators.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedCollaboratorId, setSelectedCollaboratorId] = useState<string>('')

  useEffect(() => {
    async function fetchInventory() {
      if (reportsCache.inventory.collaborators.length === 0) {
        setLoading(true)
      }
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('people')
        .select('*, person_inventories(*, stock_items(*))')
        .eq('is_active', true)
        .eq('role', 'collaborator')
        .order('full_name')

      if (fetchError) {
        setError(fetchError.message)
      } else {
        reportsCache.inventory.collaborators = (((data as unknown as CollaboratorWithInventory[]) ?? []).map((collaborator) => ({
          ...collaborator,
          person_inventories: (collaborator.person_inventories ?? []).filter((inventory) => inventory.stock_items?.is_active),
        })))
        setCollaborators(reportsCache.inventory.collaborators)
      }
      setLoading(false)
    }
    void fetchInventory()
  }, [])

  type CollabRowForTable = CollaboratorWithInventory & Record<string, unknown>

  const collaboratorOptions = useMemo(
    () => [
      { value: '', label: 'Selecione um colaborador' },
      ...collaborators.map((collaborator) => ({
        value: collaborator.id,
        label: collaborator.full_name,
      })),
    ],
    [collaborators],
  )

  const selectedCollaborator = collaborators.find((collaborator) => collaborator.id === selectedCollaboratorId)

  const tableData = useMemo<CollabRowForTable[]>(
    () => collaborators as CollabRowForTable[],
    [collaborators],
  )

  const columns = useMemo(
    () => [
      {
        key: 'full_name' as const,
        header: 'Colaborador',
        sortable: true,
        render: (_v: unknown, row: CollabRowForTable) => {
          const c = row as unknown as CollaboratorWithInventory
          return (
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              onClick={(e) => {
                e.stopPropagation()
                setExpandedId(expandedId === c.id ? null : c.id)
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className={cn(
                  'transition-transform text-gray-500',
                  expandedId === c.id && 'rotate-90',
                )}
              >
                <path
                  d="M6 4L10 8L6 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="font-medium text-white">{c.full_name}</span>
            </button>
          )
        },
      },
      {
        key: 'employee_id' as const,
        header: 'Matricula',
        sortable: true,
        render: (value: unknown) => (value as string | null) ?? '-',
      },
      {
        key: 'sector' as const,
        header: 'Setor',
        sortable: true,
        render: (value: unknown) => (value as string | null) ?? '-',
      },
      {
        key: 'person_inventories' as const,
        header: 'Itens no Inventario',
        render: (_v: unknown, row: CollabRowForTable) => {
          const c = row as unknown as CollaboratorWithInventory
          const inventories = c.person_inventories ?? []
          if (inventories.length === 0) return <span className="text-gray-500">Nenhum</span>
          return (
            <span className="text-white">
              {inventories.length} {inventories.length === 1 ? 'item' : 'itens'}
            </span>
          )
        },
      },
      {
        key: 'totalQty' as const,
        header: 'Qtd Total',
        className: 'text-center',
        render: (_v: unknown, row: CollabRowForTable) => {
          const c = row as unknown as CollaboratorWithInventory
          const total = (c.person_inventories ?? []).reduce((s, pi) => s + pi.quantity, 0)
          return <span className="font-medium text-white">{total}</span>
        },
      },
    ],
    [expandedId],
  )

  const handleExportCSV = () => {
    const rows: Record<string, unknown>[] = []
    for (const c of collaborators) {
      const invs = c.person_inventories ?? []
      if (invs.length === 0) {
        rows.push({
          Colaborador: c.full_name,
          Matricula: c.employee_id ?? '',
          Setor: c.sector ?? '',
          Item: '-',
          Quantidade: 0,
        })
      } else {
        for (const inv of invs) {
          rows.push({
            Colaborador: c.full_name,
            Matricula: c.employee_id ?? '',
            Setor: c.sector ?? '',
            Item: inv.stock_items?.name ?? '-',
            Quantidade: inv.quantity,
          })
        }
      }
    }
    exportToCSV(rows, 'inventario-colaboradores.csv')
  }

  const handleExportPDF = () => {
    const rows: Record<string, unknown>[] = []

    for (const collaborator of collaborators) {
      const inventories = collaborator.person_inventories ?? []

      if (inventories.length === 0) {
        rows.push({
          Colaborador: collaborator.full_name,
          Matricula: collaborator.employee_id ?? '',
          Setor: collaborator.sector ?? '',
          Item: '-',
          Quantidade: 0,
        })
        continue
      }

      for (const inventory of inventories) {
        rows.push({
          Colaborador: collaborator.full_name,
          Matricula: collaborator.employee_id ?? '',
          Setor: collaborator.sector ?? '',
          Item: inventory.stock_items?.name ?? '-',
          Quantidade: inventory.quantity,
        })
      }
    }

    exportToPDF(rows, 'Inventario de Colaboradores', 'Itens ativos ainda vinculados aos colaboradores.', 'inventario-colaboradores.pdf')
  }

  const handleExportIndividualPDF = (collaborator: CollaboratorWithInventory | undefined) => {
    if (!collaborator) return

    openPrintSectionedTableDocument({
      title: `Inventario Individual - ${collaborator.full_name}`,
      subtitle: 'Relatorio individual de itens ativos vinculados ao colaborador.',
      filename: `inventario-${collaborator.full_name.toLowerCase().replace(/\s+/g, '-')}.pdf`,
      sections: [
        {
          title: collaborator.full_name,
          subtitle: `Matricula: ${collaborator.employee_id ?? '-'} | Setor: ${collaborator.sector ?? '-'}`,
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'category', label: 'Categoria' },
            { key: 'quantity', label: 'Quantidade' },
            { key: 'unit', label: 'Unidade' },
          ],
          rows: (collaborator.person_inventories ?? []).length > 0
            ? collaborator.person_inventories.map((inventory) => ({
              item: inventory.stock_items?.name ?? '-',
              category: inventory.stock_items?.category ?? '-',
              quantity: inventory.quantity,
              unit: inventory.stock_items?.unit ?? '-',
            }))
            : [
              {
                item: 'Nenhum item',
                category: '-',
                quantity: 0,
                unit: '-',
              },
            ],
        },
      ],
    })
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-400">Carregando inventario...</p>
      </div>
    )
  }

  if (error) {
    return <Alert variant="danger" title="Erro ao carregar">{error}</Alert>
  }

  if (collaborators.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon size={48} />}
        title="Nenhum colaborador ativo"
          description="Nao ha colaboradores ativos cadastrados no sistema"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-sm">
          <Select
            label="PDF individual"
            options={collaboratorOptions}
            value={selectedCollaboratorId}
            onChange={(e) => setSelectedCollaboratorId(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExportIndividualPDF(selectedCollaborator)}
            disabled={!selectedCollaborator}
          >
            PDF Individual
          </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          disabled={collaborators.length === 0}
        >
          Exportar CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportPDF}
          disabled={collaborators.length === 0}
        >
          Exportar PDF
        </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <DataTable<CollabRowForTable>
          columns={columns}
          data={tableData}
          keyExtractor={(row) => (row as unknown as CollaboratorWithInventory).id}
          isLoading={false}
          emptyMessage="Nenhum colaborador encontrado"
          onRowClick={(row) => {
            const c = row as unknown as CollaboratorWithInventory
            setExpandedId(expandedId === c.id ? null : c.id)
          }}
        />

        {expandedId && (() => {
          const collab = collaborators.find((c) => c.id === expandedId)
          if (!collab || (collab.person_inventories ?? []).length === 0) return null

          return (
            <Card variant="bordered" padding="md">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-white">
                  Itens de {collab.full_name}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleExportIndividualPDF(collab)}
                >
                  PDF Individual
                </Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-gray-700">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-800">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Item</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Categoria</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">Quantidade</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Unidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collab.person_inventories.map((inv) => (
                      <tr key={inv.id} className="border-t border-gray-800">
                        <td className="px-3 py-2 text-sm text-gray-300">
                          {inv.stock_items?.name ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-400">
                          {inv.stock_items?.category ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-medium text-white">
                          {inv.quantity}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-400">
                          {inv.stock_items?.unit ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })()}
      </div>
    </div>
  )
}

function AbcCurveTab() {
  const [period, setPeriod] = useState<ReportPeriod>('month')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [abcData, setAbcData] = useState<AbcItem[]>(reportsCache.abc.items)
  const [loading, setLoading] = useState(reportsCache.abc.items.length === 0)
  const [error, setError] = useState<string | null>(null)

  const fetchAbcData = useCallback(async () => {
    if (reportsCache.abc.items.length === 0) {
      setLoading(true)
    }
    setError(null)

    let range: DateRange
    if (period === 'custom') {
      if (!customFrom || !customTo) {
        setAbcData([])
        setLoading(false)
        return
      }
      range = {
        from: new Date(customFrom + 'T00:00:00'),
        to: new Date(customTo + 'T23:59:59'),
      }
    } else {
      range = getDateRange(period)
    }

    const { data, error: fetchError } = await supabase
      .from('withdrawal_items')
      .select('quantity, stock_items:stock_items(name)')
      .gte('created_at', range.from.toISOString())
      .lte('created_at', range.to.toISOString())

    if (fetchError) {
      setError(fetchError.message)
      setAbcData([])
      setLoading(false)
      return
    }

    const rawData = (data ?? []) as unknown as {
      quantity: number
      stock_items: { name: string } | null
    }[]

    const grouped = new Map<string, number>()
    for (const item of rawData) {
      const name = item.stock_items?.name ?? 'Desconhecido'
      grouped.set(name, (grouped.get(name) ?? 0) + item.quantity)
    }

    const totalQuantity = Array.from(grouped.values()).reduce((s, q) => s + q, 0)

    const sorted = Array.from(grouped.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, totalQuantity_item]) => ({ name, totalQuantity: totalQuantity_item }))

    let cumulative = 0
    const abcItems: AbcItem[] = sorted.map((item) => {
      const pct = totalQuantity > 0 ? (item.totalQuantity / totalQuantity) * 100 : 0
      cumulative += pct
      let classification: 'A' | 'B' | 'C' = 'C'
      if (cumulative <= 80) {
        classification = 'A'
      } else if (cumulative <= 95) {
        classification = 'B'
      }
      return {
        name: item.name,
        totalQuantity: item.totalQuantity,
        percentage: Math.round(pct * 100) / 100,
        cumulativePercentage: Math.round(cumulative * 100) / 100,
        classification,
      }
    })

    reportsCache.abc.items = abcItems
    setAbcData(abcItems)
    setLoading(false)
  }, [period, customFrom, customTo])

  useEffect(() => {
    setTimeout(() => void fetchAbcData(), 0)
  }, [fetchAbcData])

  const chartData = useMemo(
    () =>
      abcData.map((item) => ({
        name: item.name.length > 20 ? item.name.substring(0, 17) + '...' : item.name,
        fullName: item.name,
        Quantidade: item.totalQuantity,
      })),
    [abcData],
  )

  const classificationBadge = useMemo<Record<string, 'danger' | 'warning' | 'default'>>(
    () => ({
      A: 'danger',
      B: 'warning',
      C: 'default',
    }),
    [],
  )

  type AbcRowForTable = AbcItem & Record<string, unknown>

  const tableData = useMemo<AbcRowForTable[]>(
    () => abcData.map((item, idx) => ({
      ...item,
      rank: idx + 1,
    })) as AbcRowForTable[],
    [abcData],
  )

  const columns = useMemo(
    () => [
      {
        key: 'rank' as const,
        header: '#',
        className: 'w-12 text-center',
        render: (value: unknown) => (
          <span className="font-mono text-gray-500">{value as number}</span>
        ),
      },
      {
        key: 'name' as const,
        header: 'Item',
        sortable: true,
        render: (_v: unknown, row: AbcRowForTable) => (
          <span className="font-medium text-white">{(row as unknown as AbcItem).name}</span>
        ),
      },
      {
        key: 'totalQuantity' as const,
        header: 'Qtd Total',
        sortable: true,
        className: 'text-right font-mono tabular-nums',
        render: (value: unknown) => (
          <span className="font-medium text-white">{value as number}</span>
        ),
      },
      {
        key: 'percentage' as const,
        header: '%',
        sortable: true,
        className: 'text-right font-mono tabular-nums',
        render: (value: unknown) => `${(value as number).toFixed(2)}%`,
      },
      {
        key: 'cumulativePercentage' as const,
        header: '% Acum.',
        sortable: true,
        className: 'text-right font-mono tabular-nums',
        render: (value: unknown) => `${(value as number).toFixed(2)}%`,
      },
      {
        key: 'classification' as const,
        header: 'Classe',
        render: (value: unknown) => {
          const cls = value as 'A' | 'B' | 'C'
          return (
            <Badge variant={classificationBadge[cls]} size="sm">
              {cls}
            </Badge>
          )
        },
      },
    ],
    [classificationBadge],
  )

  const handleExportCSV = () => {
    const rows = abcData.map((item, idx) => ({
      Rank: idx + 1,
      Item: item.name,
      'Qtd Total': item.totalQuantity,
      Porcentagem: `${item.percentage.toFixed(2)}%`,
      'Porcentagem Acumulada': `${item.cumulativePercentage.toFixed(2)}%`,
      Classificacao: item.classification,
    }))
    exportToCSV(rows, 'curva-abc-saida.csv')
  }

  return (
    <div className="flex flex-col gap-4">
      <Card variant="bordered" padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Select
              label="Periodo"
              options={PERIOD_PRESETS}
              value={period}
              onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
            />
          </div>
          {period === 'custom' && (
            <>
              <div className="w-40">
                <Input
                  type="date"
                  label="De"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="w-40">
                <Input
                  type="date"
                  label="Ate"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void fetchAbcData()}>
              Atualizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={abcData.length === 0}
            >
              Exportar CSV
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-400">Calculando curva ABC...</p>
        </div>
      ) : abcData.length === 0 ? (
        <EmptyState
          icon={<ChartIcon size={48} />}
          title="Sem dados"
          description="Nenhuma retirada encontrada no periodo selecionado"
        />
      ) : (
        <>
          <Card variant="bordered" padding="md">
            <h3 className="mb-4 text-sm font-semibold text-gray-300">
              Curva ABC - Quantidade Retirada por Item
            </h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 5, right: 20, left: 20, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    angle={-45}
                    textAnchor="end"
                    interval={0}
                    height={80}
                  />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#f9fafb',
                    }}
                    formatter={((value: unknown) => [String(value), 'Quantidade'])}
                    labelFormatter={((label: unknown, payload: readonly { payload?: { fullName?: unknown } }[] | undefined) => {
                      const fullName = payload?.[0]?.payload?.fullName
                      if (typeof fullName === 'string') return fullName
                      return String(label)
                    })}
                  />
                  <Bar dataKey="Quantidade" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <DataTable<AbcRowForTable>
            columns={columns}
            data={tableData}
            keyExtractor={(row: AbcRowForTable) => `${(row as unknown as AbcItem & { rank?: number }).name}-${(row as unknown as AbcItem & { rank?: number }).rank ?? 0}`}
            isLoading={false}
            emptyMessage="Nenhum dado encontrado"
          />
        </>
      )}
    </div>
  )
}

function LowStockTab() {
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>(reportsCache.lowStock.items)
  const [loading, setLoading] = useState(reportsCache.lowStock.items.length === 0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchLowStock() {
      if (reportsCache.lowStock.items.length === 0) {
        setLoading(true)
      }
      setError(null)

      const { data, error: fetchError } = await supabase.rpc('check_low_stock')

      if (fetchError) {
        setError(fetchError.message)
        setLowStockItems([])
      } else {
        const items = ((data as StockItemRow[] | null) ?? []).map((item): LowStockItem => {
          const deficit = item.minimum_quantity - item.current_quantity
          const severity = item.current_quantity === 0 ? 'critical' : 'warning'
          return { ...item, deficit, severity }
        })
        reportsCache.lowStock.items = items
        setLowStockItems(items)
      }
      setLoading(false)
    }
    void fetchLowStock()
  }, [])

  type LowStockRowForTable = LowStockItem & Record<string, unknown>

  const tableData = useMemo<LowStockRowForTable[]>(
    () => lowStockItems as LowStockRowForTable[],
    [lowStockItems],
  )

  const columns = useMemo(
    () => [
      {
        key: 'name' as const,
        header: 'Item',
        sortable: true,
        render: (_v: unknown, row: LowStockRowForTable) => {
          const item = row as unknown as LowStockItem
          return (
            <div className="flex items-center gap-2">
              {item.severity === 'critical' && (
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              )}
              {item.severity === 'warning' && (
                <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
              )}
              <span className="font-medium text-white">{item.name}</span>
            </div>
          )
        },
      },
      {
        key: 'category' as const,
        header: 'Categoria',
        sortable: true,
        render: (value: unknown) => (value as string | null) ?? '-',
      },
      {
        key: 'quantity' as const,
        header: 'Qtd Atual',
        className: 'text-right',
        render: (_v: unknown, row: LowStockRowForTable) => {
          const item = row as unknown as LowStockItem
          return (
            <span
              className={cn(
                'inline-block w-[88px] text-right font-medium tabular-nums',
                item.severity === 'critical' ? 'text-red-400' : 'text-orange-400',
              )}
            >
              {item.current_quantity}
            </span>
          )
        },
      },
      {
        key: 'minimum_quantity' as const,
        header: 'Qtd Minima',
        className: 'text-right',
        render: (value: unknown) => (
          <span className="inline-block w-[88px] text-right text-gray-300 tabular-nums">{value as number}</span>
        ),
      },
      {
        key: 'deficit' as const,
        header: 'Deficit',
        className: 'text-right',
        render: (_v: unknown, row: LowStockRowForTable) => {
          const item = row as unknown as LowStockItem
          return (
            <span
              className={cn(
                'inline-block w-[88px] text-right font-medium tabular-nums',
                item.severity === 'critical' ? 'text-red-400' : 'text-orange-400',
              )}
            >
              -{item.deficit}
            </span>
          )
        },
      },
      {
        key: 'severity' as const,
        header: 'Status',
        render: (_v: unknown, row: LowStockRowForTable) => {
          const item = row as unknown as LowStockItem
          return (
            <Badge variant={item.severity === 'critical' ? 'danger' : 'warning'} dot size="sm">
              {item.severity === 'critical' ? 'Critico' : 'Atencao'}
            </Badge>
          )
        },
      },
    ],
    [],
  )

  const handleExportCSV = () => {
    const rows = lowStockItems.map((item) => ({
      Item: item.name,
      Categoria: item.category ?? '',
      'Qtd Atual': item.current_quantity,
      'Qtd Minima': item.minimum_quantity,
      Deficit: item.deficit,
      Severidade: item.severity === 'critical' ? 'Critico' : 'Atencao',
    }))
    exportToCSV(rows, 'itens-abaixo-minimo.csv')
  }

  const handleExportPDF = () => {
    const rows = lowStockItems.map((item) => ({
      Item: item.name,
      Categoria: item.category ?? '',
      'Qtd Atual': item.current_quantity,
      'Qtd Minima': item.minimum_quantity,
      Deficit: item.deficit,
      Severidade: item.severity === 'critical' ? 'Critico' : 'Atencao',
    }))
    exportToPDF(rows, 'Itens Abaixo do Minimo', 'Panorama de reposicao imediata do estoque.', 'itens-abaixo-minimo.pdf')
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Spinner size="lg" />
        <p className="mt-4 text-sm text-gray-400">Verificando estoque...</p>
      </div>
    )
  }

  if (error) {
    return <Alert variant="danger" title="Erro ao carregar">{error}</Alert>
  }

  if (lowStockItems.length === 0) {
    return (
      <EmptyState
        icon={<PackageIcon size={48} />}
        title="Nenhum item abaixo do minimo"
        description="Todos os itens estao com estoque adequado"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <Alert variant="warning" title="Itens com estoque abaixo do minimo" className="min-w-0 flex-1">
          {lowStockItems.length} item(ns) encontrados abaixo da quantidade minima
        </Alert>
        <div className="flex flex-wrap gap-2 xl:ml-4 xl:justify-end">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            Exportar PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Abaixo do Minimo"
          value={lowStockItems.length}
          icon={<AlertIcon size={20} />}
          variant="danger"
        />
      </div>

      <DataTable<LowStockRowForTable>
        columns={columns}
        data={tableData}
        keyExtractor={(row) => (row as unknown as LowStockItem).id}
        isLoading={false}
        emptyMessage="Nenhum item abaixo do minimo"
      />
    </div>
  )
}

function LeaderConsumptionTab() {
  const [leaders, setLeaders] = useState<PersonRow[]>(reportsCache.leader.leaders)
  const [selectedLeader, setSelectedLeader] = useState<string>('all')
  const [period, setPeriod] = useState<ReportPeriod>('month')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [consumptionData, setConsumptionData] = useState<LeaderConsumptionItem[]>(reportsCache.leader.consumptionData)
  const [sections, setSections] = useState<LeaderConsumptionSection[]>(reportsCache.leader.sections)
  const [totalItems, setTotalItems] = useState(reportsCache.leader.totalItems)
  const [totalWithdrawals, setTotalWithdrawals] = useState(reportsCache.leader.totalWithdrawals)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchLeaders() {
      const { data } = await supabase
        .from('people')
        .select('*')
        .eq('is_active', true)
        .in('role', ['leader', 'supervisor'])
        .order('full_name')

      if (data) {
        reportsCache.leader.leaders = data as PersonRow[]
        setLeaders(reportsCache.leader.leaders)
      }
    }
    void fetchLeaders()
  }, [])

  const leaderOptions = useMemo(
    () => [
      { value: 'all', label: 'Todos os solicitantes' },
      ...leaders.map((l) => ({ value: l.id, label: l.full_name })),
    ],
    [leaders],
  )

  const fetchConsumption = useCallback(async () => {
    setLoading(true)
    setError(null)

    let range: DateRange
    if (period === 'custom') {
      if (!customFrom || !customTo) {
        setConsumptionData([])
        setLoading(false)
        return
      }
      range = {
        from: new Date(customFrom + 'T00:00:00'),
        to: new Date(customTo + 'T23:59:59'),
      }
    } else {
      range = getDateRange(period)
    }

    let query = supabase
      .from('withdrawals')
      .select('id, requested_by, withdrawal_items(quantity, stock_items:stock_items(name))')
      .in('status', ['approved', 'completed'])
      .gte('created_at', range.from.toISOString())
      .lte('created_at', range.to.toISOString())

    if (selectedLeader !== 'all') {
      query = query.eq('requested_by', selectedLeader)
    }

    const { data, error: fetchError } = await query

    if (fetchError) {
      setError(fetchError.message)
      setConsumptionData([])
      setTotalItems(0)
      setTotalWithdrawals(0)
      setLoading(false)
      return
    }

    const rawWithdrawals = (data ?? []) as unknown as {
      id: string
      requested_by: string
      withdrawal_items: {
        quantity: number
        stock_items: { name: string } | null
      }[]
    }[]

    const leaderNames = new Map(leaders.map((leader) => [leader.id, leader.full_name]))
    const grouped = new Map<string, number>()
    const groupedByLeader = new Map<string, Map<string, number>>()
    const withdrawalIdsByLeader = new Map<string, Set<string>>()
    let itemsTotal = 0
    const withdrawalIds = new Set<string>()

    for (const w of rawWithdrawals) {
      withdrawalIds.add(w.id)
      if (!groupedByLeader.has(w.requested_by)) {
        groupedByLeader.set(w.requested_by, new Map<string, number>())
      }
      if (!withdrawalIdsByLeader.has(w.requested_by)) {
        withdrawalIdsByLeader.set(w.requested_by, new Set<string>())
      }
      withdrawalIdsByLeader.get(w.requested_by)?.add(w.id)

      for (const wi of w.withdrawal_items) {
        const name = wi.stock_items?.name ?? 'Desconhecido'
        const current = grouped.get(name) ?? 0
        grouped.set(name, current + wi.quantity)
        const leaderBucket = groupedByLeader.get(w.requested_by)
        if (leaderBucket) {
          leaderBucket.set(name, (leaderBucket.get(name) ?? 0) + wi.quantity)
        }
        itemsTotal += wi.quantity
      }
    }

    const sorted = Array.from(grouped.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, quantity]) => ({ name, quantity }))

    const leaderSections = Array.from(groupedByLeader.entries())
      .map(([leaderId, leaderGrouped]) => {
        const items = Array.from(leaderGrouped.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name, quantity]) => ({ name, quantity }))
        return {
          leaderId,
          leaderName: leaderNames.get(leaderId) ?? 'Solicitante',
          items,
          totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
          totalWithdrawals: withdrawalIdsByLeader.get(leaderId)?.size ?? 0,
        }
      })
      .sort((a, b) => a.leaderName.localeCompare(b.leaderName))

    reportsCache.leader.consumptionData = sorted
    reportsCache.leader.sections = leaderSections
    reportsCache.leader.totalItems = itemsTotal
    reportsCache.leader.totalWithdrawals = withdrawalIds.size
    setConsumptionData(sorted)
    setSections(leaderSections)
    setTotalItems(itemsTotal)
    setTotalWithdrawals(withdrawalIds.size)
    setLoading(false)
  }, [selectedLeader, period, customFrom, customTo, leaders])

  useEffect(() => {
    setTimeout(() => void fetchConsumption(), 0)
  }, [fetchConsumption])

  const chartData = useMemo(
    () =>
      consumptionData.map((item) => ({
        name: item.name.length > 20 ? item.name.substring(0, 17) + '...' : item.name,
        fullName: item.name,
        Quantidade: item.quantity,
      })),
    [consumptionData],
  )

  const handleExportCSV = () => {
    const rows = consumptionData.map((item) => ({
      Item: item.name,
      Quantidade: item.quantity,
    }))
    exportToCSV(rows, selectedLeader === 'all' ? 'consumo-todos-solicitantes.csv' : `consumo-solicitante-${selectedLeader}.csv`)
  }

  const handleExportPDF = () => {
    if (selectedLeader === 'all') {
      openPrintSectionedTableDocument({
        title: 'Consumo por Solicitante',
        subtitle: 'Relatorio separado por solicitante no periodo selecionado.',
        filename: 'consumo-todos-solicitantes.pdf',
        sections: sections.map((section) => ({
          title: section.leaderName,
          subtitle: `Retiradas: ${section.totalWithdrawals} | Itens retirados: ${section.totalItems}`,
          columns: [
            { key: 'item', label: 'Item' },
            { key: 'quantity', label: 'Quantidade' },
          ],
          rows: section.items.map((item) => ({
            item: item.name,
            quantity: item.quantity,
          })),
        })),
      })
      return
    }

    const rows = consumptionData.map((item) => ({
      Item: item.name,
      Quantidade: item.quantity,
    }))
    exportToPDF(rows, 'Consumo por Solicitante', 'Resumo dos itens mais retirados pelo solicitante selecionado.', `consumo-solicitante-${selectedLeader}.pdf`)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card variant="bordered" padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Select
              label="Solicitante"
              options={leaderOptions}
              value={selectedLeader}
              onChange={(e) => setSelectedLeader(e.target.value)}
            />
          </div>
          <div className="w-44">
            <Select
              label="Periodo"
              options={PERIOD_PRESETS}
              value={period}
              onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
            />
          </div>
          {period === 'custom' && (
            <>
              <div className="w-40">
                <Input
                  type="date"
                  label="De"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="w-40">
                <Input
                  type="date"
                  label="Ate"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void fetchConsumption()}>
              Atualizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={consumptionData.length === 0}
            >
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={consumptionData.length === 0}
            >
              Exportar PDF
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-400">Calculando consumo...</p>
        </div>
      ) : consumptionData.length === 0 ? (
        <EmptyState
          icon={<ChartIcon size={48} />}
          title="Sem dados"
          description="Nenhuma retirada encontrada para este solicitante no periodo selecionado"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              title="Total Itens Retirados"
              value={totalItems}
              icon={<PackageIcon size={20} />}
            />
            <StatCard
              title="Total de Retiradas"
              value={totalWithdrawals}
              icon={<ClipboardIcon size={20} />}
            />
          </div>

          <Card variant="bordered" padding="md">
            <h3 className="mb-4 text-sm font-semibold text-gray-300">
              {selectedLeader === 'all' ? 'Itens mais retirados por todos os solicitantes' : 'Itens mais retirados pelo solicitante'}
            </h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 100, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    width={90}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#f9fafb',
                    }}
                    formatter={((value: unknown) => [String(value), 'Quantidade'])}
                    labelFormatter={((label: unknown, payload: readonly { payload?: { fullName?: unknown } }[] | undefined) => {
                      const fullName = payload?.[0]?.payload?.fullName
                      if (typeof fullName === 'string') return fullName
                      return String(label)
                    })}
                  />
                  <Bar dataKey="Quantidade" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card variant="bordered" padding="md">
            <h4 className="mb-3 text-sm font-semibold text-gray-300">Detalhamento</h4>
            <div className="overflow-hidden rounded-lg border border-gray-700">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-800">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">#</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Item</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Quantidade</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptionData.map((item, idx) => (
                    <tr key={item.name} className="border-t border-gray-800">
                      <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-white">{item.name}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-300">{item.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
