import { useState, useEffect, useCallback } from 'react'
import type { Tables } from '../types/database'
import { supabase } from '../lib/supabase'

interface StockAlertState {
  lowStockItems: Tables<'stock_items'>[]
  loading: boolean
  refetch: () => Promise<void>
}

export function useStockAlerts(): StockAlertState {
  const [lowStockItems, setLowStockItems] = useState<Tables<'stock_items'>[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLowStock = useCallback(async () => {
    setLoading(true)

    const { data, error } = await supabase.rpc('check_low_stock')

    if (error) {
      console.error('Error fetching low stock items:', error.message)
      setLowStockItems([])
    } else {
      setLowStockItems((data as Tables<'stock_items'>[]) ?? [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    setTimeout(() => void fetchLowStock(), 0)
  }, [fetchLowStock])

  useEffect(() => {
    const channel = supabase
      .channel('stock-items-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stock_items',
        },
        () => {
          void fetchLowStock()
        }
      )
      .subscribe({ reconnect: true })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchLowStock])

  return { lowStockItems, loading, refetch: fetchLowStock }
}
