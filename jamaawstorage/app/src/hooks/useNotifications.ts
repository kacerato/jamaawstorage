import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

type NotificationType =
  | 'stock_critical'
  | 'stock_low'
  | 'vehicle_maintenance_due'
  | 'vehicle_maintenance_upcoming'
  | 'stock_return_pending'
  | 'stock_return_held'
  | 'withdrawal_pending'
  | 'withdrawal_completed'
  | 'item_added'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  description: string
  createdAt: string
  linkPath: string
  itemIconKey?: string | null
  isUnread?: boolean
}

const priorityOrder: Record<NotificationType, number> = {
  stock_critical: 0,
  vehicle_maintenance_due: 1,
  stock_return_pending: 2,
  stock_return_held: 3,
  withdrawal_pending: 4,
  vehicle_maintenance_upcoming: 5,
  stock_low: 6,
  withdrawal_completed: 7,
  item_added: 8,
}

const LAST_SEEN_STORAGE_KEY = 'jamaaw-notifications-last-seen-at'

type PendingWithdrawalRow = {
  id: string
  code: string | null
  status: 'pending' | 'approved' | 'rejected' | 'completed'
  created_at: string
  updated_at: string
  requested_by_person: Pick<Tables<'people'>, 'full_name'> | null
}

type ReturnNotificationRow = {
  id: string
  quantity: number
  approved_quantity: number
  held_quantity: number
  item_condition: 'used' | 'damaged'
  status: 'pending' | 'held' | 'approved'
  created_at: string
  updated_at: string
  stock_item: Pick<Tables<'stock_items'>, 'name' | 'code' | 'unit' | 'svg_icon_key'> | null
}

type RecentItemRow = Pick<Tables<'stock_items'>, 'id' | 'name' | 'code' | 'created_at' | 'svg_icon_key'>

type VehicleMaintenanceAlertType = 'oil_change' | 'scheduled_review' | 'tires' | 'brakes' | 'document' | 'custom'

type VehicleMaintenanceNotificationRow = {
  id: string
  vehicle_id: string
  alert_type: VehicleMaintenanceAlertType
  title: string
  due_date: string | null
  due_odometer_km: number | null
  advance_days: number
  advance_km: number
  status: 'active' | 'completed' | 'disabled'
  updated_at: string
  vehicle: {
    id: string
    code: string
    plate: string | null
    model: string
    is_active: boolean
  } | null
}

type VehicleUsageLogNotificationRow = {
  vehicle_id: string
  occurred_at: string
  odometer_km: number | null
}

interface UntypedQueryBuilder {
  select: (query?: string) => UntypedQueryBuilder
  eq: (column: string, value: unknown) => UntypedQueryBuilder
  order: (column: string, options?: unknown) => UntypedQueryBuilder
  limit: (count: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

function dateInputValueFromDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateOnly(dateInput: string): string {
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

function vehicleDisplayName(vehicle: VehicleMaintenanceNotificationRow['vehicle']): string {
  if (!vehicle) return 'Carro'
  const plate = vehicle.plate ? ` / ${vehicle.plate}` : ''
  return `${vehicle.model}${plate}`
}

function vehicleMaintenanceState(
  alert: VehicleMaintenanceNotificationRow,
  currentOdometerKm: number | null,
): { label: string; type: Extract<NotificationType, 'vehicle_maintenance_due' | 'vehicle_maintenance_upcoming'> | null } {
  const today = new Date(`${dateInputValueFromDate(new Date())}T00:00:00`)
  const dateDaysLeft = alert.due_date
    ? Math.ceil((new Date(`${alert.due_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
    : null
  const kmLeft = alert.due_odometer_km != null && currentOdometerKm != null
    ? alert.due_odometer_km - currentOdometerKm
    : null

  if ((dateDaysLeft != null && dateDaysLeft < 0) || (kmLeft != null && kmLeft <= 0)) {
    return { label: 'Vencida', type: 'vehicle_maintenance_due' }
  }

  if ((dateDaysLeft != null && dateDaysLeft <= alert.advance_days) || (kmLeft != null && kmLeft <= alert.advance_km)) {
    return { label: 'Proxima', type: 'vehicle_maintenance_upcoming' }
  }

  return { label: 'Em dia', type: null }
}

function vehicleMaintenanceTarget(alert: VehicleMaintenanceNotificationRow): string {
  const parts = [
    alert.due_date ? formatDateOnly(alert.due_date) : null,
    alert.due_odometer_km != null ? `${alert.due_odometer_km.toLocaleString('pt-BR')} km` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' / ') : 'sem prazo'
}

function readLastSeenAt(): string | null {
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)
    return raw && raw.trim() ? raw : null
  } catch {
    return null
  }
}

export function useNotifications() {
  const db = useMemo(() => supabase as unknown as { from: (table: string) => UntypedQueryBuilder }, [])
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [lowStockItems, setLowStockItems] = useState<Tables<'stock_items'>[]>([])
  const [loading, setLoading] = useState(true)
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readLastSeenAt()
  )

  const refetch = useCallback(async () => {
    setLoading(true)

    try {
      const recentThreshold = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
      const [
        lowStockResult,
        returnRequestsResult,
        pendingWithdrawalsResult,
        recentWithdrawalsResult,
        recentItemsResult,
        vehicleMaintenanceResult,
        vehicleLogsResult,
      ] = await Promise.all([
        supabase.rpc('check_low_stock'),
        supabase
          .from('stock_return_requests')
          .select('id, quantity, approved_quantity, held_quantity, item_condition, status, created_at, updated_at, stock_item:stock_items(name, code, unit, svg_icon_key)')
          .in('status', ['pending', 'held'])
          .order('updated_at', { ascending: false })
          .limit(8),
        supabase
          .from('withdrawals')
          .select('id, code, status, created_at, updated_at, requested_by_person:people!withdrawals_requested_by_fkey(full_name)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('withdrawals')
          .select('id, code, status, created_at, updated_at, requested_by_person:people!withdrawals_requested_by_fkey(full_name)')
          .eq('status', 'completed')
          .gte('created_at', recentThreshold)
          .order('created_at', { ascending: false })
          .limit(4),
        supabase
          .from('stock_items')
          .select('id, name, code, created_at, svg_icon_key')
          .gte('created_at', recentThreshold)
          .order('created_at', { ascending: false })
          .limit(3),
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

      if (lowStockResult.error) throw lowStockResult.error
      if (returnRequestsResult.error) throw returnRequestsResult.error
      if (pendingWithdrawalsResult.error) throw pendingWithdrawalsResult.error
      if (recentWithdrawalsResult.error) throw recentWithdrawalsResult.error
      if (recentItemsResult.error) throw recentItemsResult.error
      if (vehicleMaintenanceResult.error) throw new Error(vehicleMaintenanceResult.error.message)
      if (vehicleLogsResult.error) throw new Error(vehicleLogsResult.error.message)

      const lowStockData = (lowStockResult.data ?? []) as Tables<'stock_items'>[]
      const returnRequests = (returnRequestsResult.data ?? []) as ReturnNotificationRow[]
      const pendingWithdrawals = (pendingWithdrawalsResult.data ?? []) as PendingWithdrawalRow[]
      const recentWithdrawals = (recentWithdrawalsResult.data ?? []) as PendingWithdrawalRow[]
      const recentItems = (recentItemsResult.data ?? []) as RecentItemRow[]
      const vehicleMaintenanceAlerts = (vehicleMaintenanceResult.data ?? []) as unknown as VehicleMaintenanceNotificationRow[]
      const vehicleLogs = (vehicleLogsResult.data ?? []) as unknown as VehicleUsageLogNotificationRow[]
      const currentOdometerByVehicle = new Map<string, number>()

      vehicleLogs.forEach((log) => {
        if (currentOdometerByVehicle.has(log.vehicle_id) || log.odometer_km == null) return
        currentOdometerByVehicle.set(log.vehicle_id, Number(log.odometer_km))
      })

      const vehicleNotifications: NotificationItem[] = []

      vehicleMaintenanceAlerts
        .filter((alert) => alert.vehicle?.is_active !== false)
        .forEach((alert) => {
          const state = vehicleMaintenanceState(alert, currentOdometerByVehicle.get(alert.vehicle_id) ?? null)
          if (!state.type) return

          vehicleNotifications.push({
            id: `vehicle-maintenance-${state.type}-${alert.id}`,
            type: state.type,
            title: `${state.label}: ${alert.title}`,
            description: `${maintenanceTypeLabel(alert.alert_type)} - ${vehicleDisplayName(alert.vehicle)} - ${vehicleMaintenanceTarget(alert)}`,
            createdAt: alert.updated_at,
            linkPath: '/vehicles',
          })
        })

      setLowStockItems(lowStockData)

      const items: NotificationItem[] = [
        ...lowStockData.map((item) => ({
          id: `${item.current_quantity === 0 ? 'stock-critical' : 'stock-low'}-${item.id}`,
          type: (item.current_quantity === 0 ? 'stock_critical' : 'stock_low') as NotificationType,
          title: item.current_quantity === 0 ? 'Estoque zerado' : 'Alerta de Estoque Baixo',
          description:
            item.current_quantity === 0
              ? `${item.name}: 0 / min. ${item.minimum_quantity} ${item.unit}`
              : `${item.name}: ${item.current_quantity} / min. ${item.minimum_quantity} ${item.unit}`,
          createdAt: item.updated_at,
          linkPath: '/stock',
          itemIconKey: item.svg_icon_key,
        })),
        ...returnRequests.map((request) => {
          const remaining = Math.max(request.quantity - request.approved_quantity - request.held_quantity, 0)
          const held = request.held_quantity
          const itemName = request.stock_item?.name ?? 'Item devolvido'
          const itemCode = request.stock_item?.code ? ` (${request.stock_item.code})` : ''
          const unit = request.stock_item?.unit ?? 'un'
          return {
            id: `stock-return-${request.status}-${request.id}`,
            type: request.status === 'held' ? 'stock_return_held' as const : 'stock_return_pending' as const,
            title: request.status === 'held' ? 'Item em triagem' : 'Devolucao pendente',
            description: request.status === 'held'
              ? `${itemName}${itemCode}: ${held} ${unit} em triagem como ${request.item_condition === 'damaged' ? 'avaria' : 'usado'}`
              : `${itemName}${itemCode}: ${remaining} ${unit} aguardando decisao`,
            createdAt: request.updated_at,
            linkPath: '/stock?tab=returns',
            itemIconKey: request.stock_item?.svg_icon_key,
          }
        }),
        ...vehicleNotifications,
        ...pendingWithdrawals.map((withdrawal) => ({
          id: `withdrawal-pending-${withdrawal.id}`,
          type: 'withdrawal_pending' as const,
          title: withdrawal.code ?? 'Retirada',
          description: `Retirada pendente - ${withdrawal.requested_by_person?.full_name ?? 'N/A'}`,
          createdAt: withdrawal.created_at,
          linkPath: '/withdrawals',
        })),
        ...recentWithdrawals.map((withdrawal) => ({
          id: `withdrawal-completed-${withdrawal.id}`,
          type: 'withdrawal_completed' as const,
          title: withdrawal.code ?? 'Retirada concluida',
          description: `Retirada concluida - ${withdrawal.requested_by_person?.full_name ?? 'N/A'}`,
          createdAt: withdrawal.created_at,
          linkPath: `/withdrawals/${withdrawal.id}`,
        })),
        ...recentItems.map((item) => ({
          id: `item-added-${item.id}`,
          type: 'item_added' as const,
          title: item.name,
          description: `Novo item adicionado (${item.code})`,
          createdAt: item.created_at,
          linkPath: '/stock',
          itemIconKey: item.svg_icon_key,
        })),
      ]

      items.sort((a, b) => {
        const priorityDiff = priorityOrder[a.type] - priorityOrder[b.type]
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })

      setNotifications(items.slice(0, 20))
    } catch (error) {
      console.error('Error fetching notifications:', error)
      setNotifications([])
      setLowStockItems([])
    } finally {
      setLoading(false)
    }
  }, [db])

  const markAllAsRead = useCallback(() => {
    const nextLastSeenAt = new Date().toISOString()
    setLastSeenAt(nextLastSeenAt)
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, nextLastSeenAt)
  }, [])

  const unreadCount = useMemo(
    () =>
      notifications.filter((item) => {
        if (!lastSeenAt) return true
        return new Date(item.createdAt).getTime() > new Date(lastSeenAt).getTime()
      }).length,
    [notifications, lastSeenAt]
  )

  const visibleNotifications = useMemo(
    () =>
      notifications.map((item) => ({
        ...item,
        isUnread: !lastSeenAt || new Date(item.createdAt).getTime() > new Date(lastSeenAt).getTime(),
      })),
    [notifications, lastSeenAt]
  )

  useEffect(() => {
    void refetch()
  }, [refetch])

  useEffect(() => {
    const syncLastSeen = (nextValue: string | null) => {
      setLastSeenAt((current) => (current === nextValue ? current : nextValue))
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LAST_SEEN_STORAGE_KEY) {
        syncLastSeen(event.newValue && event.newValue.trim() ? event.newValue : null)
      }
    }

    const handleFocus = () => {
      syncLastSeen(readLastSeenAt())
      void refetch()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleFocus()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refetch()
      }
    }, 60_000)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(interval)
    }
  }, [refetch])

  useEffect(() => {
    const channel = supabase
      .channel('notifications-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_items' }, () => {
        void refetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, () => {
        void refetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_items' }, () => {
        void refetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_return_requests' }, () => {
        void refetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_maintenance_alerts' }, () => {
        void refetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_usage_logs' }, () => {
        void refetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
        void refetch()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refetch])

  return { notifications: visibleNotifications, lowStockItems, loading, unreadCount, refetch, markAllAsRead }
}
