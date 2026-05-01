import { useState, useEffect, useCallback, useRef } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const FETCH_TIMEOUT = 30000

function isPostgrestError(err: unknown): err is PostgrestError {
  return typeof err === 'object' && err !== null && 'message' in err && 'details' in err && 'hint' in err && 'code' in err
}

function toPostgrestError(err: unknown): PostgrestError {
  if (isPostgrestError(err)) return err
  const message = err instanceof Error ? err.message : 'Erro inesperado'
  return { message, details: '', hint: '', code: 'UNKNOWN', name: 'PostgrestError', toJSON: () => ({ message, details: '', hint: '', code: 'UNKNOWN', name: 'PostgrestError' }) }
}

interface QueryState<T> {
  data: T | null
  error: PostgrestError | null
  loading: boolean
  connectionError: string | null
  refetch: () => Promise<void>
}

export function useSupabaseQuery<T>(
  queryFn: (db: typeof supabase) => Promise<{ data: T | null; error: PostgrestError | null }>
): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<PostgrestError | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)

  const executeWithTimeout = useCallback(async (): Promise<{ data: T | null; error: PostgrestError | null }> => {
    let timeoutId: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Tempo limite excedido')), FETCH_TIMEOUT)
    })

    try {
      const result = await Promise.race([queryFn(supabase), timeoutPromise])
      return result
    } finally {
      clearTimeout(timeoutId!)
    }
  }, [queryFn])

  const attemptFetch = useCallback(async (): Promise<void> => {
    try {
      const result = await executeWithTimeout()

      if (result.error) {
        throw result.error
      }

      if (!mountedRef.current) return
      setData(result.data)
      setError(null)
      setConnectionError(null)
      retryCountRef.current = 0
      setLoading(false)
    } catch (err) {
      if (!mountedRef.current) return

      setConnectionError('Conexão perdida. Tentando reconectar...')

      if (retryCountRef.current === 0) {
        retryCountRef.current = 1
        setTimeout(() => { if (mountedRef.current) void attemptFetch() }, 1000)
      } else if (retryCountRef.current === 1) {
        retryCountRef.current = 2
        setTimeout(() => { if (mountedRef.current) void attemptFetch() }, 3000)
      } else {
        setError(toPostgrestError(err))
        setLoading(false)
      }
    }
  }, [executeWithTimeout])

  const fetchData = useCallback(async () => {
    retryCountRef.current = 0
    setLoading(true)
    setError(null)
    setConnectionError(null)
    await attemptFetch()
  }, [attemptFetch])

  useEffect(() => {
    mountedRef.current = true
    setTimeout(() => void fetchData(), 0)
    return () => { mountedRef.current = false }
  }, [fetchData])

  return { data, error, loading, connectionError, refetch: fetchData }
}