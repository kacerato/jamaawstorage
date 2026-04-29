import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

export type Profile = Tables<'profiles'>
export type Session = {
  user: User | null
  profile: Profile | null
}

type Unsubscribe = () => void

const AUTH_TIMEOUT = 8000
const SESSION_CACHE_KEY = 'auth_session_cache'

function createTimeoutPromise<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Tempo de operação excedido'))
    }, timeoutMs)

    operation
      .then((result) => {
        clearTimeout(timeoutId)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('network') || message.includes('fetch') || message.includes('tempo')) {
      return 'Erro de conexão. Verifique sua internet e tente novamente.'
    }
    if (message.includes('invalid login credentials')) {
      return 'E-mail ou senha incorretos.'
    }
    if (message.includes('user not found')) {
      return 'Usuário não encontrado.'
    }
    if (message.includes('email already registered') || message.includes('user already registered')) {
      return 'Este e-mail já está cadastrado.'
    }
    if (message.includes('invalid email')) {
      return 'E-mail inválido. Verifique o formato do e-mail.'
    }
    if (message.includes('weak password') || message.includes('password')) {
      return 'Senha muito fraca. Use pelo menos 6 caracteres.'
    }
    if (message.includes('rate limit')) {
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
    }
    if (message.includes('confirm')) {
      return 'Verifique seu e-mail para confirmar o cadastro.'
    }

    return error.message
  }

  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function getCachedSession(): Session | null {
  try {
    const cached = localStorage.getItem(SESSION_CACHE_KEY)
    if (cached) {
      return JSON.parse(cached)
    }
  } catch {
    // Falha silenciosa no cache
  }
  return null
}

function setCachedSession(session: Session | null): void {
  try {
    if (session) {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(session))
    } else {
      localStorage.removeItem(SESSION_CACHE_KEY)
    }
  } catch {
    // Falha silenciosa no cache
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const { data, error } = await createTimeoutPromise(
      supabase.auth.getSession(),
      AUTH_TIMEOUT
    )

    if (error) {
      const cached = getCachedSession()
      return cached
    }

    if (!data.session?.user) {
      setCachedSession(null)
      return null
    }

    const user = data.session.user
    const profile = await fetchProfile(user.id)

    const session: Session = { user, profile }
    setCachedSession(session)

    return session
  } catch (error) {
    const cached = getCachedSession()
    return cached
  }
}

export async function signIn(
  email: string,
  password: string
): Promise<{ user: User | null; error: string | null }> {
  try {
    const { data, error } = await createTimeoutPromise(
      supabase.auth.signInWithPassword({ email, password }),
      AUTH_TIMEOUT
    )

    if (error) {
      return { user: null, error: formatError(error) }
    }

    if (!data.user) {
      return { user: null, error: 'Falha ao autenticar. Tente novamente.' }
    }

    const profile = await fetchProfile(data.user.id)
    const session: Session = { user: data.user, profile }
    setCachedSession(session)

    return { user: data.user, error: null }
  } catch (error) {
    return { user: null, error: formatError(error) }
  }
}

export async function signUp(
  email: string,
  password: string,
  metadata?: Record<string, unknown>
): Promise<{ user: User | null; error: string | null }> {
  try {
    const { data, error } = await createTimeoutPromise(
      supabase.auth.signUp({
        email,
        password,
        options: { data: metadata }
      }),
      AUTH_TIMEOUT
    )

    if (error) {
      return { user: null, error: formatError(error) }
    }

    if (!data.user) {
      return { user: null, error: 'Falha ao criar conta. Tente novamente.' }
    }

    return { user: data.user, error: null }
  } catch (error) {
    return { user: null, error: formatError(error) }
  }
}

export async function signOut(): Promise<void> {
  try {
    await createTimeoutPromise(
      supabase.auth.signOut(),
      AUTH_TIMEOUT
    )
  } catch {
    // Ignora erro no signOut
  } finally {
    setCachedSession(null)
  }
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    // Executa a query e espera o resultado
    const query = supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    const { data, error } = await createTimeoutPromise(
      Promise.resolve(query),
      AUTH_TIMEOUT
    )

    if (error) {
      return null
    }

    return data as Profile | null
  } catch {
    return null
  }
}

export function onAuthStateChange(callback: (session: Session | null) => void): Unsubscribe {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, supabaseSession) => {
      try {
        if (event === 'SIGNED_OUT' || !supabaseSession?.user) {
          setCachedSession(null)
          callback(null)
          return
        }

        const user = supabaseSession.user
        const profile = await fetchProfile(user.id)
        const session: Session = { user, profile }
        setCachedSession(session)
        callback(session)
      } catch {
        callback(null)
      }
    }
  )

  return () => {
    try {
      subscription.unsubscribe()
    } catch {
      // Ignora erro ao cancelar subscription
    }
  }
}
