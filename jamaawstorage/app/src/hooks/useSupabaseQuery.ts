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
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await executeWithTimeout()
          if (!mountedRef.current) return

          retryRef.current = false
          if (result.error) {
            setError(result.error)
          } else {
            setData(result.data)
          }
          return
        } catch (err) {
          if (!mountedRef.current) return

          if (attempt === 0 && !retryRef.current) {
            retryRef.current = true
            await new Promise((resolve) => setTimeout(resolve, 1500))
            continue
          }

          retryRef.current = false
          setError(toPostgrestError(err))
          return
        }
      }
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
