import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env')
}

const TIMEOUT_MS = 25_000
const MAX_RETRIES = 2

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchWithTimeout: typeof fetch = async (input, init) => {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok && response.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new Error(`Servidor retornou erro ${response.status}. Tentando novamente...`)
        await delay(1000 * Math.pow(2, attempt))
        continue
      }

      return response
    } catch (err) {
      clearTimeout(timeoutId)

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('A requisição excedeu o tempo limite. Verifique sua conexão.')
      }

      lastError = err instanceof Error ? err : new Error('Erro desconhecido na requisição.')

      if (attempt < MAX_RETRIES) {
        await delay(1000 * Math.pow(2, attempt))
      }
    }
  }

  throw lastError ?? new Error('A requisição falhou após múltiplas tentativas.')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: fetchWithTimeout,
  },
  realtime: {
    heartbeatIntervalMs: 15_000,
  },
})