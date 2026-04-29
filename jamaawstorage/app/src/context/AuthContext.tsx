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
  error: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    profileData: { full_name: string; employee_id?: string }
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  retry: () => void
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

const AUTH_TIMEOUT_MS = 10000 // 10 segundos máximo de espera

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Refs para controle de lifecycle e timeouts
  const isActiveRef = useRef(true)
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)

  // ── Cleanup function ──────────────────────────────────────────────────────
  const clearAuthTimeout = useCallback(() => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current)
      timeoutIdRef.current = null
    }
  }, [])

  const stopLoading = useCallback(() => {
    if (isActiveRef.current) {
      setLoading(false)
    }
    clearAuthTimeout()
  }, [clearAuthTimeout])

  // ── Profile fetch ───────────────────────────────────────────────────────────
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

  // ── Session resolution ──────────────────────────────────────────────────────
  const resolveSession = useCallback(async (authUser: User | null) => {
    if (!isActiveRef.current) return

    if (!authUser) {
      setUser(null)
      setProfile(null)
      setError(null)
      return
    }

    try {
      const prof = await fetchProfile(authUser)

      if (!isActiveRef.current) return

      // Se não for supervisor ou estiver inativo, fazer logout
      if (prof && (prof.role !== 'supervisor' || !prof.is_active)) {
        console.error('[Auth] Acesso negado: somente supervisores ativos.')
        setUser(null)
        setProfile(null)
        setError('Acesso negado: somente supervisores ativos podem acessar.')
        await supabase.auth.signOut()
        return
      }

      setUser(authUser)
      setProfile(prof)
      setError(null)
    } catch (err) {
      console.error('[Auth] Erro ao resolver sessão:', err)
      if (isActiveRef.current) {
        setError('Erro ao carregar dados do usuário.')
      }
    }
  }, [fetchProfile])

  // ── Initialize auth ───────────────────────────────────────────────────────
  const initializeAuth = useCallback(async () => {
    if (!isActiveRef.current) return

    setLoading(true)
    setError(null)

    // Setup timeout de segurança - GARANTE que loading sempre termina
    timeoutIdRef.current = setTimeout(() => {
      if (isActiveRef.current) {
        console.warn('[Auth] Timeout de inicialização atingido')
        setLoading(false)
        setError('Tempo de conexão esgotado. Verifique sua internet.')
      }
    }, AUTH_TIMEOUT_MS)

    try {
      // 1. Buscar sessão inicial
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (!isActiveRef.current) return

      if (sessionError) {
        console.error('[Auth] Erro ao obter sessão:', sessionError.message)
        setError(translateError(sessionError.message))
        stopLoading()
        return
      }

      const authUser = session?.user ?? null

      // 2. Verificar se sessão está expirada
      if (session?.expires_at) {
        const expiresAt = session.expires_at * 1000
        if (Date.now() > expiresAt) {
          console.warn('[Auth] Sessão expirada na inicialização')
          setUser(null)
          setProfile(null)
          await supabase.auth.signOut()
          stopLoading()
          return
        }
      }

      // 3. Resolver sessão
      await resolveSession(authUser)

    } catch (err) {
      console.error('[Auth] Erro fatal na inicialização:', err)
      if (isActiveRef.current) {
        setError('Erro ao inicializar autenticação.')
      }
    } finally {
      // GARANTIA ABSOLUTA: loading sempre termina aqui
      stopLoading()
    }
  }, [resolveSession, stopLoading])

  // ── Effect: Initial setup ─────────────────────────────────────────────────
  useEffect(() => {
    isActiveRef.current = true

    // Inicializar auth imediatamente
    initializeAuth()

    // 2. Configurar listener para mudanças de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isActiveRef.current) return

        // Ignorar INITIAL_SESSION pois já tratamos via getSession()
        if (event === 'INITIAL_SESSION') return

        const authUser = session?.user ?? null

        if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
          setError(null)
          return
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          // Verificar expiração
          if (session?.expires_at) {
            const expiresAt = session.expires_at * 1000
            if (Date.now() > expiresAt) {
              console.warn(`[Auth] Sessão expirada (${event})`)
              setUser(null)
              setProfile(null)
              await supabase.auth.signOut()
              return
            }
          }

          await resolveSession(authUser)
        }
      }
    )

    subscriptionRef.current = subscription

    // Cleanup
    return () => {
      isActiveRef.current = false
      clearAuthTimeout()
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = null
    }
  }, [initializeAuth, resolveSession, clearAuthTimeout])

  // ── Auth actions ────────────────────────────────────────────────────────────
  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        return { error: translateError(error.message) }
      }
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
    setError(null)
    await supabase.auth.signOut()
  }, [])

  const retry = useCallback(() => {
    initializeAuth()
  }, [initializeAuth])

  // ── Context value ────────────────────────────────────────────────────────────
  const value: AuthContextType = {
    user,
    profile,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    retry,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
