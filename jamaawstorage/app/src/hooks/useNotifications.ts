import { useState, useEffect, useCallback } from 'react'
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
}

const priorityOrder: Record<NotificationType, number> = {
  stock_critical: 0,
  withdrawal_pending: 1,
  stock_low: 2,
  item_added: 3,
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [lowStockItems, setLowStockItems] = useState<Tables<'stock_items'>[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)

    try {
      const [lowStockResult, pendingWithdrawalsResult, recentItemsResult] = await Promise.all([
        supabase.rpc('check_low_stock'),
        supabase
          .from('withdrawals')
          .select('id, code, status, created_at, requested_by')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('stock_items')
          .select('id, name, code, created_at')
          .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(3),
      ])

      if (lowStockResult.error) {
        console.error('Error fetching low stock items:', lowStockResult.error.message)
      }
      if (pendingWithdrawalsResult.error) {
        console.error('Error fetching pending withdrawals:', pendingWithdrawalsResult.error.message)
      }
      if (recentItemsResult.error) {
        console.error('Error fetching recent items:', recentItemsResult.error.message)
      }

      const lowStockData = (lowStockResult.data ?? []) as Tables<'stock_items'>[]
      setLowStockItems(lowStockData)

      // Fetch people names for pending withdrawals
      const rawWithdrawals = (pendingWithdrawalsResult.data as {
        id: string
        code: string | null
        status: string
        created_at: string
        requested_by: string | null
      }[]) ?? []

      const requestedByIds = rawWithdrawals
        .map(w => w.requested_by)
        .filter(Boolean) as string[]

      let peopleMap: Record<string, string> = {}
      if (requestedByIds.length > 0) {
        const { data: peopleData } = await supabase
          .from('people')
          .select('id, full_name')
          .in('id', Array.from(new Set(requestedByIds)))

        peopleMap = Object.fromEntries(
          (peopleData || []).map(p => [p.id, p.full_name])
        )
      }

      const recentItemsData =
        (recentItemsResult.data as {
          id: string
          name: string
          code: string
          created_at: string
        }[]) ?? []

      const items: NotificationItem[] = []

      for (const item of lowStockData) {
        if (item.current_quantity === 0) {
          items.push({
            id: `stock-critical-${item.id}`,
            type: 'stock_critical',
            title: item.name,
            description: `Estoque zerado! 0 / mín. ${item.minimum_quantity} ${item.unit}`,
            createdAt: item.updated_at,
            linkPath: '/stock',
          })
        } else {
          items.push({
            id: `stock-low-${item.id}`,
            type: 'stock_low',
            title: item.name,
            description: `Estoque baixo: ${item.current_quantity} / mín. ${item.minimum_quantity} ${item.unit}`,
            createdAt: item.updated_at,
            linkPath: '/stock',
          })
        }
      }

      for (const withdrawal of rawWithdrawals) {
        const personName = withdrawal.requested_by ? peopleMap[withdrawal.requested_by] : null
        items.push({
          id: `withdrawal-pending-${withdrawal.id}`,
          type: 'withdrawal_pending',
          title: withdrawal.code ?? 'Retirada',
          description: `Retirada pendente — ${personName ?? 'N/A'}`,
          createdAt: withdrawal.created_at,
          linkPath: '/withdrawals',
        })
      }

      for (const item of recentItemsData) {
        items.push({
          id: `item-added-${item.id}`,
          type: 'item_added',
          title: item.name,
          description: `Novo item adicionado (${item.code})`,
          createdAt: item.created_at,
          linkPath: '/stock',
        })
      }

      items.sort((a, b) => {
        const priorityDiff = priorityOrder[a.type] - priorityOrder[b.type]
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })

      setNotifications(items)
    } catch (err) {
      console.error('Error fetching notifications:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setTimeout(() => void refetch(), 0)
  }, [refetch])

  useEffect(() => {
    const channel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stock_items' },
        () => { void refetch() }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'withdrawals' },
        () => { void refetch() }
      )
      .subscribe({ reconnect: true } as never)

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refetch])

  return { notifications, loading, refetch, lowStockItems }
}
