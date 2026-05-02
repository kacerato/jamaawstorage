import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

export type Profile = Tables<'profiles'>

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

export async function fetchProfile(userId: string): Promise<{ profile: Profile | null; error: string | null }> {
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
  } catch (error) {
    return { profile: null, error: formatError(error) }
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
    const { data: createdUserId, error } = await supabase.rpc('create_supervisor_account', {
      p_email: data.email.trim(),
      p_password: data.password,
      p_full_name: data.full_name.trim(),
      p_employee_id: data.employee_id?.trim() || null,
      p_sector: data.sector?.trim() || null,
    })

    if (error) {
      return { userId: null, error: formatError(error) }
    }

    return { userId: createdUserId ?? null, error: null }
  } catch (error) {
    return { userId: null, error: formatError(error) }
  }
}
