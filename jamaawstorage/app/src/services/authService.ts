import type { User, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

export type Profile = Tables<'profiles'>

export type Session = {
  user: User | null
  profile: Profile | null
  fetchError?: string
}

export type Unsubscribe = () => void

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('network') || message.includes('fetch')) {
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
    if (message.includes('access denied') || message.includes('acesso negado')) {
      return 'Acesso negado. Somente supervisores ativos podem criar contas.'
    }
    if (message.includes('perfil nao encontrado') || message.includes('profile not found')) {
      return 'Perfil do usuário não encontrado. Tente novamente.'
    }

    return 'Ocorreu um erro inesperado. Tente novamente.'
  }

  return 'Ocorreu um erro inesperado. Tente novamente.'
}

export async function signIn(
  email: string,
  password: string
): Promise<{ user: User | null; error: string | null }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) return { user: null, error: formatError(error) }
    if (!data.user) return { user: null, error: 'Falha ao autenticar. Tente novamente.' }

    return { user: data.user, error: null }
  } catch (error) {
    return { user: null, error: formatError(error) }
  }
}

export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut()
  } catch {
    // best-effort
  }
}

export type FetchProfileResult = {
  profile: Profile | null
  error: string | null
}

export async function fetchProfile(userId: string): Promise<FetchProfileResult> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      return { profile: null, error: formatError(error) }
    }

    return { profile: data as Profile | null, error: null }
  } catch (err) {
    return { profile: null, error: formatError(err) }
  }
}

export async function getSession(): Promise<{
  session: Session | null
  error: string | null
}> {
  try {
    const {
      data: { session: supabaseSession },
      error,
    } = await supabase.auth.getSession()

    if (error) {
      return { session: null, error: formatError(error) }
    }

    if (!supabaseSession?.user) {
      return { session: null, error: null }
    }

    const result = await fetchProfile(supabaseSession.user.id)

    if (result.error) {
      return {
        session: { user: supabaseSession.user, profile: null, fetchError: result.error },
        error: null,
      }
    }

    return {
      session: { user: supabaseSession.user, profile: result.profile },
      error: null,
    }
  } catch (err) {
    return { session: null, error: formatError(err) }
  }
}

export async function createSupervisor(data: {
  email: string
  password: string
  full_name: string
  employee_id?: string
  sector?: string
}): Promise<{ userId: string | null; error: string | null }> {
  try {
    const { data: currentSession } = await supabase.auth.getSession()
    const currentAccessToken = currentSession.session?.access_token ?? null
    const currentRefreshToken = currentSession.session?.refresh_token ?? null

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: data.email.trim(),
      password: data.password,
      options: {
        data: {
          full_name: data.full_name.trim(),
          employee_id: data.employee_id?.trim() || null,
        },
      },
    })

    if (signUpError) {
      if (currentAccessToken && currentRefreshToken) {
        await supabase.auth.setSession({ access_token: currentAccessToken, refresh_token: currentRefreshToken })
      }
      return { userId: null, error: formatError(signUpError) }
    }
    if (!signUpData.user) {
      if (currentAccessToken && currentRefreshToken) {
        await supabase.auth.setSession({ access_token: currentAccessToken, refresh_token: currentRefreshToken })
      }
      return { userId: null, error: 'Falha ao criar conta. Tente novamente.' }
    }

    const newUserId = signUpData.user.id

    const { error: activateError } = await supabase.rpc('activate_supervisor_profile', {
      p_user_id: newUserId,
      p_full_name: data.full_name.trim(),
      p_employee_id: data.employee_id?.trim() || null,
      p_sector: data.sector?.trim() || null,
    })

    if (currentAccessToken && currentRefreshToken) {
      await supabase.auth.setSession({ access_token: currentAccessToken, refresh_token: currentRefreshToken })
    }

    if (activateError) {
      return { userId: null, error: formatError(activateError) }
    }

    return { userId: newUserId, error: null }
  } catch (error) {
    return { userId: null, error: formatError(error) }
  }
}

export function onAuthStateChange(
  callback: (session: Session | null, event: AuthChangeEvent) => void
): Unsubscribe {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(async (event, supabaseSession) => {
    try {
      if (event === 'SIGNED_OUT' || !supabaseSession?.user) {
        callback(null, event)
        return
      }

      const result = await fetchProfile(supabaseSession.user.id)

      if (result.error) {
        callback(
          { user: supabaseSession.user, profile: null, fetchError: result.error },
          event
        )
      } else {
        callback({ user: supabaseSession.user, profile: result.profile }, event)
      }
    } catch {
      callback(null, event)
    }
  })

  return () => subscription.unsubscribe()
}
