import { createContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Tables, TablesInsert } from '../types/database'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProfileRow = Tables<'profiles'>
type ProfileInsert = TablesInsert<'profiles'>

interface AuthContextType {
  user: User | null
  profile: ProfileRow | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    profileData: { full_name: string; employee_id?: string }
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null)

// ─── Error Translation ────────────────────────────────────────────────────────

const ERROR_MAP: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha inválidos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
  'User already registered': 'Já existe uma conta com este e-mail.',
  'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
  'Too many requests': 'Muitas tentativas. Aguarde alguns minutos.',
  'Network request failed': 'Sem conexão com a internet.',
  'invalid_grant': 'Sessão expirada. Faça login novamente.',
}

function translateError(msg: string): string {
  for (const [key, val] of Object.entries(ERROR_MAP)) {
    if (msg.includes(key)) return val
  }
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

// ─── Provider ─────────────────────────────────────────────────────────────────

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  // ── Profile fetch (no sign-out side effects) ────────────────────────────────

  const fetchProfile = useCallback(async (authUser: User): Promise<ProfileRow | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle()

      if (error) {
        console.error('[Auth] Erro ao buscar perfil:', error.message)
        return null
      }

      if (data) return data as ProfileRow

      // Auto-create supervisor profile if missing
      const fullName =
        typeof authUser.user_metadata?.full_name === 'string'
          ? authUser.user_metadata.full_name.trim()
          : authUser.email?.split('@')[0]?.trim() ?? 'Supervisor'

      const employeeId =
        typeof authUser.user_metadata?.employee_id === 'string'
          ? authUser.user_metadata.employee_id.trim()
          : null

      const fallback = {
        id: authUser.id,
        full_name: fullName || 'Supervisor',
        employee_id: employeeId,
        role: 'supervisor',
        is_active: true,
      } satisfies ProfileInsert

      const { data: created, error: createErr } = await supabase
        .from('profiles')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(fallback as any, { onConflict: 'id' })
        .select('*')
        .maybeSingle()

      if (createErr) {
        console.error('[Auth] Erro ao criar perfil:', createErr.message)
        return null
      }

      return (created as ProfileRow | null) ?? null
    } catch (err) {
      console.error('[Auth] Erro inesperado no perfil:', err)
      return null
    }
  }, [])

  // ── Resolve a user session into state ───────────────────────────────────────

  const resolveSession = useCallback(async (authUser: User | null) => {
    if (!authUser) {
      if (mountedRef.current) {
        setUser(null)
        setProfile(null)
      }
      return
    }

    const prof = await fetchProfile(authUser)

    if (!mountedRef.current) return

    // If not a supervisor or inactive, sign out quietly
    if (prof && (prof.role !== 'supervisor' || !prof.is_active)) {
      console.error('[Auth] Acesso negado: somente supervisores ativos.')
      setUser(null)
      setProfile(null)
      await supabase.auth.signOut()
      return
    }

    setUser(authUser)
    setProfile(prof)
  }, [fetchProfile])

  // ── Bootstrap: get existing session + subscribe to changes ──────────────────
  // Use onAuthStateChange which emits INITIAL_SESSION automatically.
  // This prevents concurrent getSession calls that cause GoTrue deadlocks.

  useEffect(() => {
    let ignore = false
    mountedRef.current = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (ignore) return

        const authUser = session?.user ?? null

        if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.expires_at) {
            const expiresAt = session.expires_at * 1000
            if (Date.now() > expiresAt) {
              console.warn(`[Auth] Sessão expirada (${event}). Limpando...`)
              setUser(null)
              setProfile(null)
              setLoading(false)
              // Don't await signOut here to avoid another possible lock issue if network is down
              void supabase.auth.signOut()
              return
            }
          }

          await resolveSession(authUser)
          if (!ignore) {
            setLoading(false)
          }
        }
      }
    )

    return () => {
      ignore = true
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [resolveSession])

  // ── Auth actions ──────────────────────────────────────────────────────────────

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        return { error: translateError(error.message) }
      }
      // The onAuthStateChange listener will handle setting user/profile
      return { error: null }
    },
    []
  )

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      profileData: { full_name: string; employee_id?: string }
    ): Promise<{ error: string | null }> => {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: profileData.full_name,
            employee_id: profileData.employee_id ?? null,
          },
        },
      })

      if (authError) return { error: translateError(authError.message) }
      if (!authData.user) return { error: 'Não foi possível criar a conta.' }

      const newProfile = {
        id: authData.user.id,
        full_name: profileData.full_name,
        employee_id: profileData.employee_id ?? null,
        role: 'supervisor',
        is_active: true,
      } satisfies ProfileInsert

      const { error: profileError } = await supabase
        .from('profiles')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(newProfile as any)

      if (profileError) return { error: translateError(profileError.message) }
      return { error: null }
    },
    []
  )

  const signOut = useCallback(async (): Promise<void> => {
    setUser(null)
    setProfile(null)
    await supabase.auth.signOut()
  }, [])

  // ── Context value ─────────────────────────────────────────────────────────────

  const value: AuthContextType = { user, profile, loading, signIn, signUp, signOut }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
