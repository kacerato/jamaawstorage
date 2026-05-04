import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

type NotificationType = 'stock_critical' | 'stock_low' | 'withdrawal_pending' | 'item_added'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  description: string
  createdAt: string
  linkPath: string
  itemIconKey?: string | null
}

const priorityOrder: Record<NotificationType, number> = {
  stock_critical: 0,
  withdrawal_pending: 1,
  stock_low: 2,
  item_added: 3,
}

const READ_STORAGE_KEY = 'jamaaw-notifications-read'

type PendingWithdrawalRow = {
  id: string
  code: string | null
  created_at: string
  requested_by_person: Pick<Tables<'people'>, 'full_name'> | null
}

type RecentItemRow = Pick<Tables<'stock_items'>, 'id' | 'name' | 'code' | 'created_at' | 'svg_icon_key'>

function readStoredIds(): string[] {
  try {
    const raw = window.localStorage.getItem(READ_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [lowStockItems, setLowStockItems] = useState<Tables<'stock_items'>[]>([])
  const [loading, setLoading] = useState(true)
  const [readIds, setReadIds] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readStoredIds()
  )

  const refetch = useCallback(async () => {
    setLoading(true)

    try {
      const [lowStockResult, pendingWithdrawalsResult, recentItemsResult] = await Promise.all([
        supabase.rpc('check_low_stock'),
        supabase
          .from('withdrawals')
          .select('id, code, created_at, requested_by_person:people!withdrawals_requested_by_fkey(full_name)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('stock_items')
          .select('id, name, code, created_at, svg_icon_key')
          .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(3),
      ])

      if (lowStockResult.error) throw lowStockResult.error
      if (pendingWithdrawalsResult.error) throw pendingWithdrawalsResult.error
      if (recentItemsResult.error) throw recentItemsResult.error

      const lowStockData = (lowStockResult.data ?? []) as Tables<'stock_items'>[]
      const pendingWithdrawals = (pendingWithdrawalsResult.data ?? []) as PendingWithdrawalRow[]
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
        ...pendingWithdrawals.map((withdrawal) => ({
          id: `withdrawal-pending-${withdrawal.id}`,
          type: 'withdrawal_pending' as const,
          title: withdrawal.code ?? 'Retirada',
          description: `Retirada pendente - ${withdrawal.requested_by_person?.full_name ?? 'N/A'}`,
          createdAt: withdrawal.created_at,
          linkPath: '/withdrawals',
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

      setNotifications(items)
      setReadIds((currentReadIds) => {
        const activeIds = new Set(items.map((item) => item.id))
        const nextReadIds = currentReadIds.filter((id) => activeIds.has(id))
        window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(nextReadIds))
        return nextReadIds
      })
    } catch (error) {
      console.error('Error fetching notifications:', error)
      setNotifications([])
      setLowStockItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  const markAllAsRead = useCallback(() => {
    setReadIds((currentReadIds) => {
      const nextReadIds = Array.from(new Set([...currentReadIds, ...notifications.map((item) => item.id)]))
      window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(nextReadIds))
      return nextReadIds
    })
  }, [notifications])

  const unreadCount = useMemo(
    () => notifications.filter((item) => !readIds.includes(item.id)).length,
    [notifications, readIds]
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
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refetch])

  return { notifications, lowStockItems, loading, unreadCount, refetch, markAllAsRead }
}
