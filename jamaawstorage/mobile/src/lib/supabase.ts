import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'
import type { Database } from '../data/database.types'
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from './env'
import { secureStorage } from './secureStorage'

const TIMEOUT_MS = 20_000

/**
 * Timeout menor que o web (45s): o supervisor esta no patio com sinal ruim
 * e precisa saber que falhou, nao ficar 45 segundos olhando um spinner.
 */
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Sem resposta do servidor. Verifique sua conexao.', { cause: err })
    }
    throw err instanceof Error ? err : new Error('Erro de rede.', { cause: err })
  } finally {
    clearTimeout(timeoutId)
  }
}

if (!hasSupabaseConfig) {
  // Erro explicito na inicializacao, igual ao web: um app que sobe sem
  // credencial da erro de rede confuso em cada tela.
  throw new Error(
    'Supabase nao configurado. Defina EXPO_PUBLIC_SUPABASE_URL e ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY no arquivo .env do projeto mobile.',
  )
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Sem deep link de confirmacao por e-mail neste app.
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
})

/**
 * No React Native o refresh automatico precisa ser pausado em background:
 * sem isso o timer dispara com o app suspenso e queima tentativa de refresh.
 */
let appStateSubscription: { remove: () => void } | null = null

export function startAutoRefreshLifecycle(): () => void {
  appStateSubscription?.remove()

  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh()
    } else {
      void supabase.auth.stopAutoRefresh()
    }
  })

  if (AppState.currentState === 'active') {
    void supabase.auth.startAutoRefresh()
  }

  return () => {
    appStateSubscription?.remove()
    appStateSubscription = null
    void supabase.auth.stopAutoRefresh()
  }
}
