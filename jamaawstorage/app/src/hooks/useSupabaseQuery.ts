import { useState, useEffect, useCallback, useRef } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const FETCH_TIMEOUT = 30000

function toPostgrestError(err: unknown): PostgrestError {
  if (typeof err === 'object' && err !== null && 'details' in err && 'hint' in err && 'code' in err) {
    return err as PostgrestError
  }
  const message = err instanceof Error ? err.message : 'Erro inesperado'
  const base = { message, details: '', hint: '', code: 'UNKNOWN' as const, name: 'PostgrestError' as const }
  return { ...base, toJSON: () => base }
}

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
  const mountedRef = useRef(true)
  const retryRef = useRef(false)

  const executeWithTimeout = useCallback(async () => {
    let timeoutId: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Tempo limite excedido. Verifique sua conexão.')), FETCH_TIMEOUT)
    })
    try {
      return await Promise.race([queryFn(supabase), timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  }, [queryFn])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await executeWithTimeout()
      if (!mountedRef.current) return

      if (result.error) {
        setError(result.error)
      } else {
        setData(result.data)
      }
    } catch (err) {
      if (!mountedRef.current) return

      if (!retryRef.current) {
        retryRef.current = true
        setTimeout(() => void fetchData(), 1500)
        return
      }

      setError(toPostgrestError(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [executeWithTimeout])

  useEffect(() => {
    mountedRef.current = true
    setTimeout(() => void fetchData(), 0)
    return () => { mountedRef.current = false }
  }, [fetchData])

  return { data, error, loading, refetch: fetchData }
}