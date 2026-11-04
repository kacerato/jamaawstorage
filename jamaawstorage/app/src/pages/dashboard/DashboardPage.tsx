import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Tables, WithdrawalDestinationType } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { cn, formatDateTime } from '../../lib/utils'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import {
  Alert,
  Card,
  Badge,
  Spinner,
  EmptyState,
} from '../../components/ui'
import {
  PackageIcon,
  AlertIcon,
  ClipboardIcon,
  UsersIcon,
  ChartIcon,
} from '../../components/icons'
import { CalendarDays, Wrench } from 'lucide-react'

interface DashboardStatsData {
  total_items: number
  low_stock_count: number
  total_withdrawals_today: number
  active_people_count: number
}

type VehicleMaintenanceAlertType = 'oil_change' | 'scheduled_review' | 'tires' | 'brakes' | 'document' | 'custom'
type VehicleMaintenanceStatus = 'active' | 'completed' | 'disabled'

interface DashboardVehicleRow {
  id: string
  code: string
  plate: string | null
  model: string
  is_active: boolean
}

interface DashboardVehicleLogRow {
  vehicle_id: string
  occurred_at: string
  odometer_km: number | null
}

interface DashboardVehicleMaintenanceAlertRow {
  id: string
  vehicle_id: string
  alert_type: VehicleMaintenanceAlertType
  title: string
  due_date: string | null
  due_odometer_km: number | null
  advance_days: number
  advance_km: number
  status: VehicleMaintenanceStatus
  updated_at: string
  vehicle?: DashboardVehicleRow | null
}

interface LowStockItem extends Tables<'stock_items'> {
  is_low_stock: boolean
}

interface RecentWithdrawal extends Tables<'withdrawals'> {
  requested_by_person: Tables<'people'> | null
  collaborator?: Pick<Tables<'people'>, 'id' | 'full_name'> | null
  work_site?: Pick<Tables<'work_sites'>, 'id' | 'name'> | null
  withdrawal_items: {
    id: string
    destination_type: WithdrawalDestinationType | null
    collaborator_id: string | null
    work_site_id: string | null
    collaborator?: Pick<Tables<'people'>, 'id' | 'full_name'> | null
    work_site?: Pick<Tables<'work_sites'>, 'id' | 'name'> | null
  }[]
}

const dashboardCache: {
  stats: DashboardStatsData
  lowStockItems: LowStockItem[]
  recentWithdrawals: RecentWithdrawal[]
  vehicleMaintenanceAlerts: DashboardVehicleMaintenanceAlertRow[]
  vehicleUsageLogs: DashboardVehicleLogRow[]
} = {
  stats: {
    total_items: 0,
    low_stock_count: 0,
    total_withdrawals_today: 0,
    active_people_count: 0,
  },
  lowStockItems: [],
  recentWithdrawals: [],
  vehicleMaintenanceAlerts: [],
  vehicleUsageLogs: [],
}

interface UntypedQueryBuilder {
  select: (query?: string) => UntypedQueryBuilder
  eq: (column: string, value: unknown) => UntypedQueryBuilder
  order: (column: string, options?: unknown) => UntypedQueryBuilder
  limit: (count: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

/* ok / warn / blaze: a mesma escala semantica dos tokens. */
const chartColors = ['#4ADE80', '#FBBF24', '#FF5D00']

const commandActions = [
  {
    title: 'Nova retirada',
    description: 'Registrar saida de materiais',
    path: '/withdrawals/new',
    icon: <ClipboardIcon size={22} />,
    tone: 'primary',
  },
  {
    title: 'Estoque',
    description: 'Buscar e ajustar itens',
    path: '/stock',
    icon: <PackageIcon size={22} />,
    tone: 'stock',
  },
  {
    title: 'Colaboradores',
    description: 'Consultar responsaveis',
    path: '/people',
    icon: <UsersIcon size={22} />,
    tone: 'people',
  },
  {
    title: 'Relatorios',
    description: 'Exportar indicadores',
    path: '/reports',
    icon: <ChartIcon size={22} />,
    tone: 'reports',
  },
] as const

/*
 * So a acao primaria recebe o acento preenchido; as outras tres sao
 * iguais entre si. Quatro cores concorrentes eram o que fazia a faixa
 * de atalhos competir com os alertas.
 */
const commandActionToneClasses: Record<(typeof commandActions)[number]['tone'], string> = {
  primary: 'bg-blaze text-blaze-ink hover:bg-blaze/90',
  stock: 'bg-surface text-ink hover:bg-void',
  people: 'bg-surface text-ink hover:bg-void',
  reports: 'bg-surface text-ink hover:bg-void',
}

function MiniMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'warning' | 'success' | 'danger'
}) {
  /* O estado tinge o numero, nao a caixa. */
  const toneClasses = {
    neutral: 'text-ink',
    warning: 'text-warn',
    success: 'text-ok',
    danger: 'text-ink',
  }

  return (
    <div className="min-w-0 overflow-hidden bg-void px-3 py-3 sm:px-4">
      <p className="label-mono min-h-[30px] max-w-full break-words leading-[15px]">
        {label}
      </p>
      <p className={cn('num mt-2 text-2xl leading-none', toneClasses[tone])}>{value}</p>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
}: {
  eyebrow: string
  title: string
}) {
  return (
    <div>
      <p className="label-mono">{eyebrow}</p>
      <h3 className="mt-1 text-lg font-semibold text-ink">{title}</h3>
    </div>
  )
}

function dateInputValueFromDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function todayDateInputValue(): string {
  return dateInputValueFromDate(new Date())
}

function formatDateOnly(dateInput: string | null): string {
  if (!dateInput) return '-'
  return new Date(`${dateInput}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function maintenanceTypeLabel(type: VehicleMaintenanceAlertType): string {
  const labels: Record<VehicleMaintenanceAlertType, string> = {
    oil_change: 'Troca de oleo',
    scheduled_review: 'Revisao',
    tires: 'Pneus',
    brakes: 'Freios',
    document: 'Documento',
    custom: 'Alerta',
  }

  return labels[type]
}

function vehicleMaintenanceIcon(type: VehicleMaintenanceAlertType) {
  if (type === 'document') return <CalendarDays size={18} />
  if (type === 'brakes') return <AlertIcon size={18} />
  return <Wrench size={18} />
}

function vehicleDisplayName(vehicle: DashboardVehicleRow | null | undefined): string {
  if (!vehicle) return 'Carro'
  const plate = vehicle.plate ? ` / ${vehicle.plate}` : ''
  return `${vehicle.model}${plate}`
}

function vehicleMaintenanceState(
  alert: DashboardVehicleMaintenanceAlertRow,
  currentOdometerKm: number | null,
): {
  label: string
  variant: 'success' | 'warning' | 'danger'
  priority: number
} {
  const today = new Date(`${todayDateInputValue()}T00:00:00`)
  const dateDaysLeft = alert.due_date
    ? Math.ceil((new Date(`${alert.due_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
    : null
  const kmLeft = alert.due_odometer_km != null && currentOdometerKm != null
    ? alert.due_odometer_km - currentOdometerKm
    : null

  if ((dateDaysLeft != null && dateDaysLeft < 0) || (kmLeft != null && kmLeft <= 0)) {
    return { label: 'Vencida', variant: 'danger', priority: 0 }
  }

  if ((dateDaysLeft != null && dateDaysLeft <= alert.advance_days) || (kmLeft != null && kmLeft <= alert.advance_km)) {
    return { label: 'Proxima', variant: 'warning', priority: 1 }
  }

  return { label: 'Em dia', variant: 'success', priority: 2 }
}

function vehicleAlertTargetSummary(alert: DashboardVehicleMaintenanceAlertRow): string {
  const parts = [
    alert.due_date ? formatDateOnly(alert.due_date) : null,
    alert.due_odometer_km != null ? `${alert.due_odometer_km.toLocaleString('pt-BR')} km` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' / ') : 'Sem prazo'
}

function withdrawalItemDestinationLabel(
  item: RecentWithdrawal['withdrawal_items'][number],
  withdrawal: RecentWithdrawal,
): string {
  const destinationType = item.destination_type ?? withdrawal.destination_type

  if (destinationType === 'collaborator') {
    return item.collaborator?.full_name ?? withdrawal.collaborator?.full_name ?? 'Colaborador'
  }

  return item.work_site?.name ?? withdrawal.work_site?.name ?? 'Obra'
}

function withdrawalDestinationsSummary(withdrawal: RecentWithdrawal): string {
  const uniqueDestinations = Array.from(new Set(
    withdrawal.withdrawal_items.map((item) => withdrawalItemDestinationLabel(item, withdrawal)),
  ))

  if (uniqueDestinations.length > 0) {
    return uniqueDestinations.join(' / ')
  }

  return withdrawal.destination_type === 'collaborator'
    ? withdrawal.collaborator?.full_name ?? 'Colaborador'
    : withdrawal.work_site?.name ?? 'Obra'
}

function stockItemTarget(item: Pick<LowStockItem, 'id' | 'code' | 'name'>): string {
  const query = item.code?.trim() || item.name
  return `/stock?tab=items&item=${encodeURIComponent(item.id)}&q=${encodeURIComponent(query)}`
}

export function DashboardPage() {
  const navigate = useNavigate()
  const db = useMemo(() => supabase as unknown as { from: (table: string) => UntypedQueryBuilder }, [])
  const [loading, setLoading] = useState(
    dashboardCache.lowStockItems.length === 0 && dashboardCache.recentWithdrawals.length === 0
  )
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<DashboardStatsData>(dashboardCache.stats)
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>(dashboardCache.lowStockItems)
  const [recentWithdrawals, setRecentWithdrawals] = useState<RecentWithdrawal[]>(dashboardCache.recentWithdrawals)
  const [vehicleMaintenanceAlerts, setVehicleMaintenanceAlerts] = useState<DashboardVehicleMaintenanceAlertRow[]>(
    dashboardCache.vehicleMaintenanceAlerts,
  )
  const [vehicleUsageLogs, setVehicleUsageLogs] = useState<DashboardVehicleLogRow[]>(dashboardCache.vehicleUsageLogs)
  const [activeHealthIndex, setActiveHealthIndex] = useState(0)

  useEffect(() => {
    async function fetchDashboardData() {
      const shouldShowFullLoading =
        dashboardCache.lowStockItems.length === 0 && dashboardCache.recentWithdrawals.length === 0

      if (shouldShowFullLoading) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      setError(null)

      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]

      try {
        const [
          stockResult,
          withdrawalsResult,
          peopleResult,
          recentWithdrawalsResult,
          vehicleMaintenanceResult,
          vehicleLogsResult,
        ] = await Promise.all([
          supabase
            .from('stock_items')
            .select('id, name, category, unit, updated_at, current_quantity, minimum_quantity', { count: 'exact' }),
          supabase
            .from('withdrawals')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', todayStr),
          supabase
            .from('people')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true)
            .neq('role', 'supervisor'),
          supabase
            .from('withdrawals')
            .select('*, requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(id, full_name), work_site:work_sites!withdrawals_work_site_id_fkey(id, name), withdrawal_items(id, destination_type, collaborator_id, work_site_id, collaborator:people!withdrawal_items_collaborator_id_fkey(id, full_name), work_site:work_sites!withdrawal_items_work_site_id_fkey(id, name))')
            .order('created_at', { ascending: false })
            .limit(10),
          db
            .from('vehicle_maintenance_alerts')
            .select('*, vehicle:vehicles(id, code, plate, model, is_active)')
            .eq('status', 'active')
            .order('updated_at', { ascending: false })
            .limit(20),
          db
            .from('vehicle_usage_logs')
            .select('vehicle_id, occurred_at, odometer_km')
            .order('occurred_at', { ascending: false })
            .limit(200),
        ])

        if (stockResult.error) {
          setError(stockResult.error.message)
          return
        }
        if (vehicleMaintenanceResult.error) {
          setError(vehicleMaintenanceResult.error.message)
          return
        }
        if (vehicleLogsResult.error) {
          setError(vehicleLogsResult.error.message)
          return
        }

        const lowItems = ((stockResult.data ?? []) as Tables<'stock_items'>[]).filter(
          (item) => item.minimum_quantity > 0 && item.current_quantity <= item.minimum_quantity
        )

        const nextLowStockItems = lowItems.map((item) => ({ ...item, is_low_stock: true }))
        const typedWithdrawals = (recentWithdrawalsResult.data ?? []) as unknown as RecentWithdrawal[]
        const typedVehicleMaintenanceAlerts = (vehicleMaintenanceResult.data ?? []) as unknown as DashboardVehicleMaintenanceAlertRow[]
        const typedVehicleUsageLogs = (vehicleLogsResult.data ?? []) as unknown as DashboardVehicleLogRow[]
        const nextStats = {
          total_items: stockResult.count ?? 0,
          low_stock_count: nextLowStockItems.length,
          total_withdrawals_today: withdrawalsResult.count ?? 0,
          active_people_count: peopleResult.count ?? 0,
        }

        dashboardCache.lowStockItems = nextLowStockItems
        dashboardCache.recentWithdrawals = typedWithdrawals
        dashboardCache.vehicleMaintenanceAlerts = typedVehicleMaintenanceAlerts
        dashboardCache.vehicleUsageLogs = typedVehicleUsageLogs
        dashboardCache.stats = nextStats

        setLowStockItems(nextLowStockItems)
        setRecentWithdrawals(typedWithdrawals)
        setVehicleMaintenanceAlerts(typedVehicleMaintenanceAlerts)
        setVehicleUsageLogs(typedVehicleUsageLogs)
        setStats(nextStats)
      } catch (err) {
        console.error('Dashboard Error:', err)
        setError(err instanceof Error ? err.message : 'Erro inesperado ao carregar dados')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    }

    void fetchDashboardData()
  }, [db])

  const lowStockPreview = lowStockItems.slice(0, 4)
  const recentWithdrawalsPreview = recentWithdrawals.slice(0, 5)
  const criticalStockCount = lowStockItems.filter((item) => item.current_quantity <= 0).length
  const lowButAvailableStockCount = Math.max(lowStockItems.length - criticalStockCount, 0)
  const healthyStockCount = Math.max(stats.total_items - lowStockItems.length, 0)

  const stockHealthData = useMemo(() => [
    { name: 'Regular', value: healthyStockCount },
    { name: 'Baixo', value: lowButAvailableStockCount },
    { name: 'Zerado', value: criticalStockCount },
  ].filter((item) => item.value > 0), [criticalStockCount, healthyStockCount, lowButAvailableStockCount])

  const stockHealthPercent = stats.total_items > 0
    ? Math.round((healthyStockCount / stats.total_items) * 100)
    : 0

  const activeHealthSegment = stockHealthData[activeHealthIndex] ?? stockHealthData[0]
  const activeHealthPercent = activeHealthSegment && stats.total_items > 0
    ? Math.round((activeHealthSegment.value / stats.total_items) * 100)
    : stockHealthPercent

  const operationsScore = Math.max(
    0,
    Math.min(
      100,
      stockHealthPercent - Math.min(criticalStockCount * 8, 32) - Math.min(lowButAvailableStockCount * 2, 18),
    ),
  )

  const highlightLabel = criticalStockCount > 0
    ? `${criticalStockCount} item(ns) zerado(s)`
    : lowStockItems.length > 0
      ? `${lowStockItems.length} item(ns) abaixo do minimo`
      : 'Estoque dentro do minimo'

  /* A severidade entra pela faixa lateral e pelo icone, nunca pelo fundo. */
  const alertToneClasses = {
    danger: {
      row: 'border-l-2 border-l-crit bg-void hover:bg-surface',
      icon: 'text-crit',
      badge: 'danger' as const,
    },
    warning: {
      row: 'border-l-2 border-l-warn bg-void hover:bg-surface',
      icon: 'text-warn',
      badge: 'warning' as const,
    },
    success: {
      row: 'border-l-2 border-l-ok bg-void hover:bg-surface',
      icon: 'text-ok',
      badge: 'success' as const,
    },
  }

  const currentOdometerByVehicle = useMemo(() => {
    const map = new Map<string, number>()

    vehicleUsageLogs.forEach((log) => {
      if (map.has(log.vehicle_id) || log.odometer_km == null) return
      map.set(log.vehicle_id, Number(log.odometer_km))
    })

    return map
  }, [vehicleUsageLogs])

  const vehicleAlertItems = useMemo(() => vehicleMaintenanceAlerts
    .filter((alert) => alert.vehicle?.is_active !== false)
    .map((alert) => {
      const currentOdometerKm = currentOdometerByVehicle.get(alert.vehicle_id) ?? null
      const state = vehicleMaintenanceState(alert, currentOdometerKm)

      return {
        alert,
        state,
      }
    })
    .filter((item) => item.state.priority <= 1)
    .sort((left, right) => {
      const priorityDiff = left.state.priority - right.state.priority
      if (priorityDiff !== 0) return priorityDiff
      return new Date(right.alert.updated_at).getTime() - new Date(left.alert.updated_at).getTime()
    })
    .slice(0, 4), [currentOdometerByVehicle, vehicleMaintenanceAlerts])

  const vehicleAlertCount = vehicleAlertItems.length

  const statusBadgeVariant = (
    status: string
  ): 'success' | 'warning' | 'danger' | 'default' => {
    switch (status) {
      case 'approved':
      case 'completed':
        return 'success'
      case 'pending':
        return 'warning'
      case 'rejected':
        return 'danger'
      default:
        return 'default'
    }
  }

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'approved':
        return 'Aprovada'
      case 'completed':
        return 'Concluida'
      case 'pending':
        return 'Pendente'
      case 'rejected':
        return 'Rejeitada'
      default:
        return status
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Spinner size="lg" />
        <p className="mt-4 text-sm text-ink-dim">Carregando dados...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <Alert variant="danger" title="Erro ao carregar dados">
          {error}
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-ink">Painel de Controle</h2>
        </div>
        {refreshing && (
          <div className="label-mono inline-flex w-fit items-center gap-2 bg-surface px-3 py-1.5">
            <span className="h-2 w-2 animate-pulse bg-blaze" />
            Atualizando painel
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.58fr)_minmax(280px,0.62fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card padding="none" className="overflow-hidden">
            <div className="grid min-h-[330px] grid-cols-1 lg:grid-cols-[minmax(0,1.16fr)_330px]">
              <div className="flex flex-col justify-between gap-8 p-6 lg:p-8">
                <div>
                  <div className="label-mono inline-flex items-center gap-2">
                    <span className="h-2 w-2 bg-blaze" />
                    Operacao agora
                  </div>
                  <h3 className="mt-5 max-w-2xl text-3xl font-bold leading-tight text-ink lg:text-4xl">
                    {highlightLabel}
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
                  <MiniMetric label="Itens" value={stats.total_items} />
                  <MiniMetric
                    label="Estoque baixo"
                    value={stats.low_stock_count}
                    tone={stats.low_stock_count > 0 ? 'warning' : 'success'}
                  />
                  <MiniMetric label="Retiradas hoje" value={stats.total_withdrawals_today} />
                  <MiniMetric label="Colab. ativos" value={stats.active_people_count} />
                </div>
              </div>

              <div className="relative flex min-h-[270px] flex-col items-center justify-between gap-3 border-t border-line bg-void p-4 sm:p-5 lg:border-l lg:border-t-0">
                <div className="self-start lg:absolute lg:left-5 lg:top-5 lg:self-auto">
                  <p className="label-mono">Indice</p>
                  <p className="num mt-1 text-3xl text-ink">{operationsScore}</p>
                </div>

                <div className="relative mt-8 h-[174px] w-full max-w-[218px] sm:h-[194px] sm:max-w-[244px] lg:mt-10">
                  {stockHealthData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stockHealthData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="62%"
                          outerRadius="86%"
                          startAngle={90}
                          endAngle={450}
                          paddingAngle={4}
                          stroke="#262422"
                          strokeWidth={2}
                          animationBegin={80}
                          animationDuration={850}
                          animationEasing="ease-out"
                          onMouseEnter={(_entry, index) => setActiveHealthIndex(index)}
                          onClick={(_entry, index) => setActiveHealthIndex(index)}
                          className="cursor-pointer outline-none"
                        >
                          {stockHealthData.map((entry, index) => (
                            <Cell
                              key={entry.name}
                              fill={chartColors[index % chartColors.length]}
                              opacity={activeHealthIndex === index ? 1 : 0.62}
                              stroke={activeHealthIndex === index ? '#FFFAFA' : '#262422'}
                              strokeWidth={activeHealthIndex === index ? 3 : 2}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center border border-line text-sm text-ink-mute">
                      Sem dados
                    </div>
                  )}

                  {/* Circular por estar dentro do anel; e a unica excecao ao canto vivo. */}
                  <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-void text-center transition-all duration-300 sm:h-28 sm:w-28">
                    <span className="label-mono max-w-[76px] truncate sm:max-w-[88px]">
                      {activeHealthSegment?.name ?? 'Disponivel'}
                    </span>
                    <span className="num mt-0.5 text-2xl text-ink transition-all duration-300 sm:text-3xl">{activeHealthPercent}%</span>
                    <span className="mt-0.5 text-[11px] text-ink-dim">
                      {activeHealthSegment ? `${activeHealthSegment.value} item(ns)` : 'em estoque'}
                    </span>
                  </div>
                </div>

                <div className="grid w-full grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  {stockHealthData.map((entry, index) => (
                    <button
                      key={entry.name}
                      type="button"
                      onMouseEnter={() => setActiveHealthIndex(index)}
                      onFocus={() => setActiveHealthIndex(index)}
                      onClick={() => setActiveHealthIndex(index)}
                      className={cn(
                        'min-w-0 border px-3 py-2 text-left transition-colors',
                        activeHealthIndex === index
                          ? 'border-ink bg-surface'
                          : 'border-line bg-surface hover:border-ink-mute',
                      )}
                      aria-pressed={activeHealthIndex === index}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0"
                          style={{ backgroundColor: chartColors[index % chartColors.length] }}
                        />
                        <span className="truncate text-ink-dim">{entry.name}</span>
                      </div>
                      <p className="num mt-1 text-ink">{entry.value}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
            {commandActions.map((action) => (
              <button
                key={action.path}
                type="button"
                onClick={() => navigate(action.path)}
                className={cn(
                  'group flex min-h-[76px] items-center gap-3 px-4 py-3 text-left transition-colors',
                  commandActionToneClasses[action.tone],
                )}
              >
                <span className="flex shrink-0 items-center justify-center">
                  {action.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold">{action.title}</span>
                  <span className="mt-0.5 block truncate text-sm leading-5 opacity-70">{action.description}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <Card
              variant="bordered"
              className="rounded-none border-line bg-surface"
            >
              <div className="flex items-start justify-between gap-4">
                <SectionHeading
                  eyebrow="Reposicao"
                  title="Estoque baixo"
                />
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={lowStockItems.length > 0 ? 'warning' : 'success'}
                    size="sm"
                  >
                    {lowStockItems.length}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => navigate('/stock')}
                    className="min-h-touch border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:border-ink-mute hover:text-ink"
                  >
                    Estoque
                  </button>
                </div>
              </div>

              {lowStockItems.length === 0 ? (
                <div className="mt-7">
                  <EmptyState
                    icon={<PackageIcon size={44} />}
                    title="Nenhum item em alerta"
                    description="Os itens monitorados estao acima do minimo."
                  />
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-3">
                  {lowStockPreview.map((item) => {
                    const percentage =
                      item.minimum_quantity > 0
                        ? Math.round((item.current_quantity / item.minimum_quantity) * 100)
                        : 0
                    const barColor =
                      item.current_quantity === 0
                        ? 'bg-crit'
                        : item.current_quantity < item.minimum_quantity
                          ? 'bg-blaze'
                          : 'bg-ok'

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(stockItemTarget(item))}
                        className="border-b border-line bg-void p-4 text-left transition-colors last:border-b-0 hover:bg-surface"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{item.name}</p>
                            <p className="mt-1 truncate text-xs text-ink-dim">
                              {item.category ?? 'Sem categoria'} / {item.unit}
                            </p>
                          </div>
                          <Badge
                            variant={item.current_quantity === 0 ? 'danger' : 'warning'}
                            size="sm"
                          >
                            {item.current_quantity} / {item.minimum_quantity}
                          </Badge>
                        </div>
                        <div className="mt-3">
                          <div className="h-1.5 w-full overflow-hidden bg-line">
                            <div
                              className={cn('h-full transition-all', barColor)}
                              style={{
                                width: `${Math.min(percentage, 100)}%`,
                              }}
                            />
                          </div>
                          <p className="label-mono mt-1 text-right">{percentage}% do minimo</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card
              variant="bordered"
              className="rounded-none border-line bg-surface"
            >
              <div className="flex items-start justify-between gap-4">
                <SectionHeading
                  eyebrow="Movimento"
                  title="Retiradas recentes"
                />
                <button
                  type="button"
                  onClick={() => navigate('/withdrawals')}
                  className="min-h-touch border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:border-ink-mute hover:text-ink"
                >
                  Ver todas
                </button>
              </div>

              {recentWithdrawalsPreview.length === 0 ? (
                <div className="mt-7">
                  <EmptyState
                    icon={<ClipboardIcon size={44} />}
                    title="Nenhuma retirada registrada"
                    description="As retiradas aparecerao aqui quando forem criadas."
                  />
                </div>
              ) : (
                <div className="mt-5 flex flex-col divide-y divide-line border-t border-line">
                  {recentWithdrawalsPreview.map((withdrawal) => (
                    <button
                      key={withdrawal.id}
                      type="button"
                      onClick={() => navigate('/withdrawals')}
                      className="grid grid-cols-1 gap-3 bg-void px-4 py-3 text-left transition-colors hover:bg-surface md:grid-cols-[120px_minmax(0,1fr)_90px]"
                    >
                      <div>
                        <p className="label-mono">Codigo</p>
                        <p className="num mt-1 text-ink">{withdrawal.code ?? '-'}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {withdrawal.requested_by_person?.full_name ?? 'Sem solicitante'}
                        </p>
                        <p className="mt-1 truncate text-xs text-ink-dim">
                          {withdrawalDestinationsSummary(withdrawal)} / {withdrawal.withdrawal_items?.length ?? 0} item(ns)
                        </p>
                        <p className="label-mono mt-1">{formatDateTime(withdrawal.created_at)}</p>
                      </div>
                      <div className="flex items-start md:justify-end">
                        <Badge
                          variant={statusBadgeVariant(withdrawal.status)}
                          size="sm"
                          dot
                        >
                          {statusLabel(withdrawal.status)}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        <aside className="grid min-w-0 auto-rows-min grid-cols-1 gap-5 xl:sticky xl:top-24">
          <Card
            variant="bordered"
            className="rounded-none border-line bg-surface"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="label-mono">Alertas</p>
                <h3 className="mt-1 text-lg font-semibold text-ink">Carros</h3>
              </div>
              <Badge variant={vehicleAlertItems.some((item) => item.state.variant === 'danger') ? 'danger' : vehicleAlertCount > 0 ? 'warning' : 'success'} size="sm">
                {vehicleAlertCount}
              </Badge>
            </div>

            <div className="mt-4 grid gap-3">
              {vehicleAlertItems.length === 0 ? (
                <div className="border-l-2 border-l-ok bg-void p-3">
                  <div className="flex items-center gap-3">
                    <span className="flex shrink-0 items-center justify-center text-ok">
                      <Wrench size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">Sem revisão pendente</span>
                      <span className="mt-0.5 block text-xs text-ink-dim">Nenhum alerta vencido ou próximo</span>
                    </span>
                  </div>
                </div>
              ) : (
                vehicleAlertItems.map(({ alert, state }) => {
                  const toneClasses = alertToneClasses[state.variant]

                  return (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => navigate('/vehicles')}
                      className={cn('flex items-center gap-3 p-3 text-left transition-colors', toneClasses.row)}
                    >
                      <span className={cn('flex shrink-0 items-center justify-center', toneClasses.icon)}>
                        {vehicleMaintenanceIcon(alert.alert_type)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{alert.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-dim">
                          {maintenanceTypeLabel(alert.alert_type)} / {vehicleDisplayName(alert.vehicle)}
                        </span>
                        <span className="label-mono mt-0.5 block truncate">{vehicleAlertTargetSummary(alert)}</span>
                      </span>
                      <Badge variant={toneClasses.badge} size="sm">
                        {state.label}
                      </Badge>
                    </button>
                  )
                })
              )}
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => navigate('/vehicles')}
                className="min-h-touch w-full border border-line px-3 text-sm font-medium text-ink transition-colors hover:border-ink-mute"
              >
                Abrir carros
              </button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
