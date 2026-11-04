import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Busca com cache em disco.
 *
 * O caso real do app: supervisor na obra, sinal ruim ou nenhum. Um spinner
 * eterno ou uma tela de erro vazia sao inuteis ali. Entao:
 *
 * 1. Mostra o cache em disco imediatamente, marcado com a hora da coleta.
 * 2. Busca o dado novo em segundo plano.
 * 3. Se a busca falhar, mantem o cache na tela e avisa que esta defasado.
 *
 * A tela nunca fica em branco se ja houve uma coleta bem-sucedida.
 */

const CACHE_PREFIX = 'jamaaw.cache.'

interface CacheEnvelope<T> {
  data: T
  fetchedAt: string
}

export type QueryState<T> =
  | { status: 'loading'; data: null; fetchedAt: null; error: null; stale: false }
  | { status: 'ready'; data: T; fetchedAt: string; error: null; stale: boolean }
  | { status: 'error'; data: null; fetchedAt: null; error: string; stale: false }
  /** Cache na tela, mas a ultima tentativa de atualizar falhou. */
  | { status: 'ready'; data: T; fetchedAt: string; error: string; stale: true }

export interface CachedQuery<T> {
  data: T | null
  /** ISO da coleta que gerou os dados na tela. */
  fetchedAt: string | null
  loading: boolean
  /** Atualizando com dado ja na tela (pull-to-refresh). */
  refreshing: boolean
  /** Erro da ultima tentativa. Pode coexistir com dados em cache. */
  error: string | null
  /** Dados vem do cache e a atualizacao falhou. */
  stale: boolean
  refresh: () => Promise<void>
}

export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>): CachedQuery<T> {
  const [data, setData] = useState<T | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  const mountedRef = useRef(true)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const cacheKey = `${CACHE_PREFIX}${key}`

      if (mode === 'initial') {
        // Cache primeiro: a tela ja tem conteudo antes da rede responder.
        try {
          const raw = await AsyncStorage.getItem(cacheKey)
          if (raw && mountedRef.current) {
            const envelope = JSON.parse(raw) as CacheEnvelope<T>
            setData(envelope.data)
            setFetchedAt(envelope.fetchedAt)
            setLoading(false)
          }
        } catch {
          // Cache corrompido ou ausente: segue para a rede.
        }
      } else {
        setRefreshing(true)
      }

      try {
        const fresh = await fetcherRef.current()
        if (!mountedRef.current) return

        const now = new Date().toISOString()
        setData(fresh)
        setFetchedAt(now)
        setError(null)
        setStale(false)

        void AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({ data: fresh, fetchedAt: now } satisfies CacheEnvelope<T>),
        ).catch(() => {
          // Sem espaco ou storage indisponivel: os dados ainda estao na tela.
        })
      } catch (err) {
        if (!mountedRef.current) return

        const message = err instanceof Error ? err.message : 'Erro ao carregar dados.'
        setError(message)
        // Se ha cache na tela, ele continua; so fica marcado como defasado.
        setStale((current) => current || data != null)
      } finally {
        if (mountedRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    // `data` fora das deps de proposito: ele muda a cada carga e recriaria
    // o callback em loop. A leitura de `data` no catch e intencionalmente
    // do fechamento anterior, e so decide se marca stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  useEffect(() => {
    void load('initial')
  }, [load])

  const refresh = useCallback(async () => {
    await load('refresh')
  }, [load])

  return {
    data,
    fetchedAt,
    loading,
    refreshing,
    error,
    stale: stale && data != null,
    refresh,
  }
}

/** "agora", "há 5 min", "há 2 h", "ontem". */
export function formatAge(iso: string | null): string | null {
  if (!iso) return null

  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'ontem'
  return `há ${days} dias`
}
