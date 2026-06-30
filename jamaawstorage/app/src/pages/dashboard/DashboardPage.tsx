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

interface DashboardStatsData {
  total_items: number
  low_stock_count: number
  total_withdrawals_today: number
  active_people_count: number
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
} = {
  stats: {
    total_items: 0,
    low_stock_count: 0,
    total_withdrawals_today: 0,
    active_people_count: 0,
  },
  lowStockItems: [],
  recentWithdrawals: [],
}

const chartColors = ['#22c55e', '#f97316', '#ef4444']

const actionCards = [
  {
    title: 'Nova retirada',
    description: 'Registrar saida de materiais',
    path: '/withdrawals/new',
    icon: <ClipboardIcon size={22} />,
    className: 'border-orange-400/24 bg-orange-500/12 text-orange-100 hover:border-orange-300/50',
  },
  {
    title: 'Estoque',
    description: 'Buscar e ajustar itens',
    path: '/stock',
    icon: <PackageIcon size={22} />,
    className: 'border-emerald-400/24 bg-emerald-500/12 text-emerald-100 hover:border-emerald-300/50',
  },
  {
    title: 'Colaboradores',
    description: 'Consultar responsaveis',
    path: '/people',
    icon: <UsersIcon size={22} />,
    className: 'border-sky-400/24 bg-sky-500/12 text-sky-100 hover:border-sky-300/50',
  },
  {
    title: 'Relatorios',
    description: 'Exportar indicadores',
    path: '/reports',
    icon: <ChartIcon size={22} />,
    className: 'border-violet-400/24 bg-violet-500/12 text-violet-100 hover:border-violet-300/50',
  },
]

function MiniMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'warning' | 'success' | 'danger'
}) {
  const toneClasses = {
    neutral: 'border-white/10 bg-white/5 text-white',
    warning: 'border-orange-300/20 bg-orange-500/10 text-orange-100',
    success: 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100',
    danger: 'border-red-300/20 bg-red-500/10 text-red-100',
  }

  return (
    <div className={cn('min-w-0 rounded-2xl border px-4 py-3', toneClasses[tone])}>
      <p className="truncate text-xs font-medium uppercase tracking-[0.16em] text-white/50">{label}</p>
      <p className="mt-2 truncate text-2xl font-bold">{value}</p>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-200/70">{eyebrow}</p>
      <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
      {description && <p className="mt-1 text-sm text-gray-400">{description}</p>}
    </div>
  )
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

export function DashboardPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(
    dashboardCache.lowStockItems.length === 0 && dashboardCache.recentWithdrawals.length === 0
  )
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<DashboardStatsData>(dashboardCache.stats)
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>(dashboardCache.lowStockItems)
  const [recentWithdrawals, setRecentWithdrawals] = useState<RecentWithdrawal[]>(dashboardCache.recentWithdrawals)

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
        ])

        if (stockResult.error) {
          setError(stockResult.error.message)
          return
        }

        const lowItems = ((stockResult.data ?? []) as Tables<'stock_items'>[]).filter(
          (item) => item.minimum_quantity > 0 && item.current_quantity <= item.minimum_quantity
        )

        const nextLowStockItems = lowItems.map((item) => ({ ...item, is_low_stock: true }))
        const typedWithdrawals = (recentWithdrawalsResult.data ?? []) as unknown as RecentWithdrawal[]
        const nextStats = {
          total_items: stockResult.count ?? 0,
          low_stock_count: nextLowStockItems.length,
          total_withdrawals_today: withdrawalsResult.count ?? 0,
          active_people_count: peopleResult.count ?? 0,
        }

        dashboardCache.lowStockItems = nextLowStockItems
        dashboardCache.recentWithdrawals = typedWithdrawals
        dashboardCache.stats = nextStats

        setLowStockItems(nextLowStockItems)
        setRecentWithdrawals(typedWithdrawals)
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
  }, [])

  const lowStockPreview = lowStockItems.slice(0, 4)
  const recentWithdrawalsPreview = recentWithdrawals.slice(0, 5)
  const criticalStockCount = lowStockItems.filter((item) => item.current_quantity <= 0).length
  const healthyStockCount = Math.max(stats.total_items - lowStockItems.length, 0)
  const pendingWithdrawalsCount = recentWithdrawals.filter((withdrawal) => withdrawal.status === 'pending').length
  const completedWithdrawalsCount = recentWithdrawals.filter((withdrawal) => withdrawal.status === 'completed').length

  const stockHealthData = useMemo(() => [
    { name: 'Regular', value: healthyStockCount },
    { name: 'Baixo', value: Math.max(lowStockItems.length - criticalStockCount, 0) },
    { name: 'Zerado', value: criticalStockCount },
  ].filter((item) => item.value > 0), [criticalStockCount, healthyStockCount, lowStockItems.length])

  const stockHealthPercent = stats.total_items > 0
    ? Math.round((healthyStockCount / stats.total_items) * 100)
    : 0

  const operationsScore = Math.max(
    0,
    Math.min(
      100,
      stockHealthPercent - Math.min(pendingWithdrawalsCount * 4, 20) - Math.min(criticalStockCount * 8, 32),
    ),
  )

  const highlightLabel = criticalStockCount > 0
    ? `${criticalStockCount} item(ns) zerado(s)`
    : lowStockItems.length > 0
      ? `${lowStockItems.length} item(ns) abaixo do minimo`
      : 'Estoque dentro do minimo'

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
        <p className="mt-4 text-sm text-gray-400">Carregando dados...</p>
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
          <h2 className="text-2xl font-bold text-white">Painel de Controle</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Leitura rapida do almoxarifado: saude do estoque, acoes principais e pontos que precisam de atencao.
          </p>
        </div>
        {refreshing && (
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-orange-300/20 bg-orange-500/10 px-3 py-1.5 text-xs text-orange-100">
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
            Atualizando painel
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.7fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card
            padding="none"
            className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_72%_34%,rgba(249,115,22,0.18),transparent_35%),linear-gradient(135deg,#121318_0%,#0b0f14_52%,#101827_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.28)]"
          >
            <div className="grid min-h-[360px] grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_360px]">
              <div className="flex flex-col justify-between gap-8 p-6 lg:p-8">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-orange-100">
                    <span className="h-2 w-2 rounded-full bg-orange-400" />
                    Operacao agora
                  </div>
                  <h3 className="mt-5 max-w-2xl text-3xl font-bold leading-tight text-white lg:text-4xl">
                    {highlightLabel}
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-gray-300">
                    O painel prioriza o que exige decisao primeiro: disponibilidade do estoque, retiradas do dia e pendencias recentes.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniMetric label="Itens" value={stats.total_items} />
                  <MiniMetric
                    label="Estoque baixo"
                    value={stats.low_stock_count}
                    tone={stats.low_stock_count > 0 ? 'warning' : 'success'}
                  />
                  <MiniMetric label="Retiradas hoje" value={stats.total_withdrawals_today} />
                  <MiniMetric label="Pessoas ativas" value={stats.active_people_count} />
                </div>
              </div>

              <div className="relative flex min-h-[320px] items-center justify-center border-t border-white/8 bg-black/10 p-6 lg:border-l lg:border-t-0">
                <div className="absolute left-5 top-5 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/50">Indice</p>
                  <p className="mt-1 text-3xl font-bold text-white">{operationsScore}</p>
                </div>

                <div className="relative h-[250px] w-full max-w-[310px]">
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
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth={2}
                        >
                          {stockHealthData.map((entry, index) => (
                            <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-full border border-white/10 text-sm text-gray-500">
                      Sem dados
                    </div>
                  )}

                  <div className="absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white/12 bg-[#111318]/92 text-center shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur">
                    <span className="text-xs uppercase tracking-[0.18em] text-white/45">Saude</span>
                    <span className="mt-1 text-4xl font-bold text-white">{stockHealthPercent}%</span>
                    <span className="mt-1 text-xs text-gray-400">regular</span>
                  </div>
                </div>

                <div className="absolute bottom-5 left-5 right-5 grid grid-cols-3 gap-2 text-xs">
                  {stockHealthData.map((entry, index) => (
                    <div key={entry.name} className="min-w-0 rounded-xl border border-white/8 bg-white/6 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: chartColors[index % chartColors.length] }}
                        />
                        <span className="truncate text-white/60">{entry.name}</span>
                      </div>
                      <p className="mt-1 font-semibold text-white">{entry.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {actionCards.map((action) => (
              <button
                key={action.path}
                type="button"
                onClick={() => navigate(action.path)}
                className={cn(
                  'group flex min-h-[128px] flex-col justify-between rounded-[24px] border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(0,0,0,0.22)]',
                  action.className,
                )}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-black/16 text-white">
                  {action.icon}
                </span>
                <span>
                  <span className="block text-base font-semibold text-white">{action.title}</span>
                  <span className="mt-1 block text-sm leading-5 text-white/64">{action.description}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <Card
              variant="bordered"
              className="rounded-[24px] border-white/10 bg-[#101114]"
            >
              <div className="flex items-start justify-between gap-4">
                <SectionHeading
                  eyebrow="Reposicao"
                  title="Estoque baixo"
                  description="Itens que estao no limite ou abaixo do minimo."
                />
                <Badge
                  variant={lowStockItems.length > 0 ? 'warning' : 'success'}
                  size="sm"
                >
                  {lowStockItems.length}
                </Badge>
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
                        ? 'bg-red-500'
                        : item.current_quantity < item.minimum_quantity
                          ? 'bg-orange-500'
                          : 'bg-emerald-500'

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate('/stock')}
                        className="rounded-2xl border border-white/8 bg-white/4 p-4 text-left transition-colors hover:border-orange-300/35 hover:bg-white/7"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{item.name}</p>
                            <p className="mt-1 truncate text-xs text-gray-400">
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
                          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                            <div
                              className={cn('h-full rounded-full transition-all', barColor)}
                              style={{
                                width: `${Math.min(percentage, 100)}%`,
                              }}
                            />
                          </div>
                          <p className="mt-1 text-right text-xs text-gray-500">{percentage}% do minimo</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card
              variant="bordered"
              className="rounded-[24px] border-white/10 bg-[#101114]"
            >
              <div className="flex items-start justify-between gap-4">
                <SectionHeading
                  eyebrow="Movimento"
                  title="Retiradas recentes"
                  description="Ultimos registros com destino, quantidade e status."
                />
                <button
                  type="button"
                  onClick={() => navigate('/withdrawals')}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-orange-300/40 hover:text-orange-100"
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
                <div className="mt-5 flex flex-col divide-y divide-white/8 overflow-hidden rounded-2xl border border-white/8">
                  {recentWithdrawalsPreview.map((withdrawal) => (
                    <button
                      key={withdrawal.id}
                      type="button"
                      onClick={() => navigate('/withdrawals')}
                      className="grid grid-cols-1 gap-3 bg-white/3 px-4 py-3 text-left transition-colors hover:bg-white/7 md:grid-cols-[120px_minmax(0,1fr)_90px]"
                    >
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Codigo</p>
                        <p className="mt-1 font-semibold text-white">{withdrawal.code ?? '-'}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {withdrawal.requested_by_person?.full_name ?? 'Sem solicitante'}
                        </p>
                        <p className="mt-1 truncate text-xs text-gray-400">
                          {withdrawalDestinationsSummary(withdrawal)} / {withdrawal.withdrawal_items?.length ?? 0} item(ns)
                        </p>
                        <p className="mt-1 text-xs text-gray-500">{formatDateTime(withdrawal.created_at)}</p>
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

        <aside className="grid auto-rows-min gap-5">
          <Card
            variant="bordered"
            className="rounded-[24px] border-white/10 bg-[#101114]"
          >
            <SectionHeading
              eyebrow="Coluna lateral"
              title="Prioridade"
              description="Resumo fino para decidir o proximo passo."
            />

            <div className="mt-5 grid gap-3">
              <div className="rounded-2xl border border-red-300/18 bg-red-500/8 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500/16 text-red-100">
                    <AlertIcon size={20} />
                  </span>
                  <p className="text-3xl font-bold text-white">{criticalStockCount}</p>
                </div>
                <p className="mt-3 text-sm font-medium text-red-100">Itens zerados</p>
                <p className="mt-1 text-xs leading-5 text-red-100/62">Reposicao urgente quando houver demanda operacional.</p>
              </div>

              <div className="rounded-2xl border border-amber-300/18 bg-amber-500/8 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/16 text-amber-100">
                    <ClipboardIcon size={20} />
                  </span>
                  <p className="text-3xl font-bold text-white">{pendingWithdrawalsCount}</p>
                </div>
                <p className="mt-3 text-sm font-medium text-amber-100">Retiradas pendentes</p>
                <p className="mt-1 text-xs leading-5 text-amber-100/62">Conferir solicitacoes recentes antes de novas saidas.</p>
              </div>
            </div>
          </Card>

          <Card
            variant="bordered"
            className="rounded-[24px] border-white/10 bg-[#101114]"
          >
            <SectionHeading
              eyebrow="Rodape interno"
              title="Sinais rapidos"
            />

            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniMetric label="Regular" value={healthyStockCount} tone="success" />
              <MiniMetric label="Baixo" value={lowStockItems.length} tone={lowStockItems.length > 0 ? 'warning' : 'success'} />
              <MiniMetric label="Zerado" value={criticalStockCount} tone={criticalStockCount > 0 ? 'danger' : 'success'} />
              <MiniMetric label="Concluidas" value={completedWithdrawalsCount} />
            </div>
          </Card>

          <Card
            variant="bordered"
            className="rounded-[24px] border-white/10 bg-[#101114]"
          >
            <SectionHeading
              eyebrow="Atalho"
              title="Painel limpo"
              description="Acoes ficam separadas de alertas para reduzir ruido visual."
            />
            <button
              type="button"
              onClick={() => navigate('/stock')}
              className="mt-5 w-full rounded-2xl border border-orange-300/24 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-100 transition-colors hover:border-orange-300/45 hover:bg-orange-500/16"
            >
              Abrir estoque completo
            </button>
          </Card>
        </aside>
      </div>
    </div>
  )
}
