import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

type NotificationType =
  | 'stock_critical'
  | 'stock_low'
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
  stock_return_pending: 1,
  stock_return_held: 2,
  withdrawal_pending: 3,
  stock_low: 4,
  withdrawal_completed: 5,
  item_added: 6,
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

function readLastSeenAt(): string | null {
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)
    return raw && raw.trim() ? raw : null
  } catch {
    return null
  }
}

export function useNotifications() {
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
      const [lowStockResult, returnRequestsResult, pendingWithdrawalsResult, recentWithdrawalsResult, recentItemsResult] = await Promise.all([
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
      ])

      if (lowStockResult.error) throw lowStockResult.error
      if (returnRequestsResult.error) throw returnRequestsResult.error
      if (pendingWithdrawalsResult.error) throw pendingWithdrawalsResult.error
      if (recentWithdrawalsResult.error) throw recentWithdrawalsResult.error
      if (recentItemsResult.error) throw recentItemsResult.error

      const lowStockData = (lowStockResult.data ?? []) as Tables<'stock_items'>[]
      const returnRequests = (returnRequestsResult.data ?? []) as ReturnNotificationRow[]
      const pendingWithdrawals = (pendingWithdrawalsResult.data ?? []) as PendingWithdrawalRow[]
      const recentWithdrawals = (recentWithdrawalsResult.data ?? []) as PendingWithdrawalRow[]
      const recentItems = (recentItemsResult.data ?? []) as RecentItemRow[]

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
  }, [])

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
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refetch])

  return { notifications: visibleNotifications, lowStockItems, loading, unreadCount, refetch, markAllAsRead }
}
