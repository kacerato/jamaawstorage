import { useState, useEffect, useCallback } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface QueryState<T> {
  data: T | null
  error: PostgrestError | null
  loading: boolean
  refetch: () => Promise<void>
}

export function useSupabaseQuery<T>(
  queryFn: (db: typeof supabase) => Promise<{ data: T | null; error: PostgrestError | null }>
): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<PostgrestError | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await queryFn(supabase)
      setData(result.data)
      setError(result.error)
    } catch (err) {
      console.error('useSupabaseQuery error:', err)
      setError({
        message: err instanceof Error ? err.message : 'Erro inesperado',
        details: '',
        hint: '',
        code: 'UNKNOWN',
      } as PostgrestError)
    } finally {
      setLoading(false)
    }
  }, [queryFn])

  useEffect(() => {
    setTimeout(() => void fetchData(), 0)
  }, [fetchData])

  return { data, error, loading, refetch: fetchData }
}
