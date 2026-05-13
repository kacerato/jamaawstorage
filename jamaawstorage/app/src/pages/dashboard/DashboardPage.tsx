import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { cn, formatDateTime } from '../../lib/utils'
import {
  StatCard,
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
  withdrawal_items: { id: string }[]
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
            .select('*, requested_by_person:people!withdrawals_requested_by_fkey(*), withdrawal_items(id)')
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
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Painel de Controle</h2>
        <p className="mt-1 text-sm text-gray-400">
          Visao geral do almoxarifado e atividades recentes
        </p>
        {refreshing && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-orange-200/75">
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
            Atualizando painel...
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Itens"
          value={stats.total_items}
          icon={<PackageIcon size={20} />}
          variant="default"
        />
        <StatCard
          title="Estoque Baixo"
          value={stats.low_stock_count}
          icon={<AlertIcon size={20} />}
          variant={stats.low_stock_count > 0 ? 'danger' : 'default'}
        />
        <StatCard
          title="Retiradas Hoje"
          value={stats.total_withdrawals_today}
          icon={<ClipboardIcon size={20} />}
          variant="default"
        />
        <StatCard
          title="Colaboradores Ativos"
          value={stats.active_people_count}
          icon={<UsersIcon size={20} />}
          variant="default"
        />
      </div>

      {lowStockItems.length > 0 && (
        <section>
          <Card variant="bordered">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/20 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-orange-200">
                  Estoque Baixo
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">Reposicao que pede atencao agora</h3>
                <p className="mt-1 text-sm text-gray-400">
                  {lowStockItems.length} item(ns) abaixo do minimo. O painel mostra so os 4 primeiros para manter o layout limpo.
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-gray-300">
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Amostra visivel</p>
                <p className="mt-2 text-2xl font-semibold text-white">{lowStockPreview.length}</p>
                {lowStockItems.length > lowStockPreview.length && (
                  <p className="mt-1 text-xs text-orange-300">
                    +{lowStockItems.length - lowStockPreview.length} item(ns) no estoque
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                  <Card
                    key={item.id}
                    variant="bordered"
                    onClick={() => navigate('/stock')}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col gap-1">
                        <p className="font-medium text-white">{item.name}</p>
                        <p className="text-xs text-gray-400">
                          {item.category ?? 'Sem categoria'} • {item.unit}
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
                      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
                        <div
                          className={cn('h-full rounded-full transition-all', barColor)}
                          style={{
                            width: `${Math.min(percentage, 100)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-right text-xs text-gray-500">
                        {percentage}%
                      </p>
                    </div>
                  </Card>
                )
              })}
            </div>

            {lowStockItems.length > lowStockPreview.length && (
              <button
                type="button"
                onClick={() => navigate('/stock')}
                className="mt-4 text-sm font-medium text-orange-300 transition-colors hover:text-orange-200"
              >
                Ver lista completa no estoque
              </button>
            )}
          </Card>
        </section>
      )}

      <section>
        <Card>
          <h3 className="text-lg font-semibold text-white">
            Retiradas Recentes
          </h3>
          <p className="mt-1 text-sm text-gray-400">
            Ultimas retiradas registradas no sistema
          </p>

          {recentWithdrawals.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                icon={<ClipboardIcon size={48} />}
                title="Nenhuma retirada registrada"
                description="As retiradas aparecerao aqui quando forem criadas"
              />
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-700">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-800">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Codigo</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Solicitante</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Destino</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Itens</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Data</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWithdrawals.map((withdrawal) => (
                    <tr
                      key={withdrawal.id}
                      className="cursor-pointer border-t border-gray-800 transition-colors hover:bg-gray-800/50"
                      onClick={() => navigate('/withdrawals')}
                    >
                      <td className="px-4 py-3 text-sm text-white">
                        {withdrawal.code ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {withdrawal.requested_by_person?.full_name ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {withdrawal.destination_type === 'collaborator' ? 'Colaborador' : 'Obra'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {withdrawal.withdrawal_items?.length ?? 0}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {formatDateTime(withdrawal.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge
                          variant={statusBadgeVariant(withdrawal.status)}
                          size="sm"
                          dot
                        >
                          {statusLabel(withdrawal.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  )
}
