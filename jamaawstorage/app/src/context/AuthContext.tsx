import { createContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Tables } from '../types/database'
import {
  getSession,
  signIn as authSignIn,
  signUp as authSignUp,
  signOut as authSignOut,
  fetchProfile,
  onAuthStateChange,
} from '../services/authService'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProfileRow = Tables<'profiles'>

type AuthState = 'idle' | 'loading' | 'authenticated' | 'unauthenticated' | 'error'

interface AuthContextType {
  user: User | null
  profile: ProfileRow | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
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

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTH_TIMEOUT_MS = 10000 // 10 segundos máximo

// ─── Provider ─────────────────────────────────────────────────────────────────

function AuthProvider({ children }: { children: ReactNode }) {
  // Estado simples sem refs complexas
  const [state, setState] = useState<AuthState>('idle')
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Timeout ID para cleanup
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  // Guard: quando true, onAuthStateChange não interfere (signIn/signOut gerenciam o estado)
  const isManualActionRef = useRef(false)

  // Computed
  const loading = state === 'loading'
  const isAuthenticated = state === 'authenticated'

  // ── Cleanup function ──────────────────────────────────────────────────────
  const clearAuthTimeout = useCallback(() => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current)
      timeoutIdRef.current = null
    }
  }, [])

  const setSafeState = useCallback((newState: AuthState) => {
    if (isMountedRef.current) {
      setState(newState)
    }
  }, [])

  const setSafeError = useCallback((message: string | null) => {
    if (isMountedRef.current) {
      setError(message)
    }
  }, [])

  const setSafeUser = useCallback((newUser: User | null) => {
    if (isMountedRef.current) {
      setUser(newUser)
    }
  }, [])

  const setSafeProfile = useCallback((newProfile: ProfileRow | null) => {
    if (isMountedRef.current) {
      setProfile(newProfile)
    }
  }, [])

  // ── Initialize auth ─────────────────────────────────────────────────────────
  const initializeAuth = useCallback(async () => {
    // Limpa estado anterior
    setSafeState('loading')
    setSafeError(null)

    // Timeout ABSOLUTO de 10 segundos - GARANTE que loading sempre termina
    timeoutIdRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setSafeState('error')
        setSafeError('Tempo de conexão esgotado. Verifique sua internet e tente novamente.')
      }
    }, AUTH_TIMEOUT_MS)

    try {
      // 1. Buscar sessão inicial
      const session = await getSession()

      // Se o componente desmontou, aborta
      if (!isMountedRef.current) return

      // Limpa o timeout pois a operação completou
      clearAuthTimeout()

      // 2. Sem sessão = não autenticado
      if (!session?.user) {
        setSafeUser(null)
        setSafeProfile(null)
        setSafeState('unauthenticated')
        return
      }

      const authUser = session.user
      const userProfile = session.profile

      // 3. Verificar se é supervisor ativo
      if (userProfile && (userProfile.role !== 'supervisor' || !userProfile.is_active)) {
        await authSignOut()
        setSafeUser(null)
        setSafeProfile(null)
        setSafeError('Acesso negado: somente supervisores ativos podem acessar.')
        setSafeState('error')
        return
      }

      // 4. Autenticado com sucesso
      setSafeUser(authUser)
      setSafeProfile(userProfile)
      setSafeError(null)
      setSafeState('authenticated')

    } catch (err) {
      if (!isMountedRef.current) return
      clearAuthTimeout()

      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido'
      setSafeError(`Erro ao inicializar autenticação: ${errorMessage}`)
      setSafeState('error')
    }
  }, [clearAuthTimeout, setSafeError, setSafeState, setSafeUser, setSafeProfile])

  // ── Effect: Initial setup ───────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true

    // Inicia em idle e chama initialize
    initializeAuth()

    // Listener para mudanças de estado em tempo real
    // Ignora eventos durante ações manuais (signIn/signOut) para evitar race conditions
    const unsubscribe = onAuthStateChange((session) => {
      if (!isMountedRef.current) return
      if (isManualActionRef.current) return

      if (!session) {
        // Usuário deslogou em outra aba ou token expirou
        setSafeUser(null)
        setSafeProfile(null)
        setSafeState('unauthenticated')
      } else {
        // Sessão renovada ou atualizada
        setSafeUser(session.user)
        setSafeProfile(session.profile)
        setSafeState('authenticated')
      }
    })

    // Cleanup perfeito quando componente desmonta
    return () => {
      isMountedRef.current = false
      clearAuthTimeout()
      unsubscribe()
    }
  }, [initializeAuth, clearAuthTimeout, setSafeUser, setSafeProfile, setSafeState])

  // ── Auth actions ────────────────────────────────────────────────────────────
  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      isManualActionRef.current = true
      setSafeState('loading')
      setSafeError(null)

      try {
        const { user: authUser, error: signInError } = await authSignIn(email, password)

        if (signInError || !authUser) {
          const errMsg = signInError || 'Erro ao fazer login'
          setSafeError(errMsg)
          setSafeState('unauthenticated')
          return { error: errMsg }
        }

        // Buscar profile após login
        const userProfile = await fetchProfile(authUser.id)

        // Verificar permissões
        if (userProfile && (userProfile.role !== 'supervisor' || !userProfile.is_active)) {
          await authSignOut()
          setSafeUser(null)
          setSafeProfile(null)
          const errMsg = 'Acesso negado: somente supervisores ativos podem acessar.'
          setSafeError(errMsg)
          setSafeState('unauthenticated')
          return { error: errMsg }
        }

        setSafeUser(authUser)
        setSafeProfile(userProfile)
        setSafeState('authenticated')
        return { error: null }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Erro ao fazer login'
        setSafeError(errMsg)
        setSafeState('unauthenticated')
        return { error: errMsg }
      } finally {
        // Libera o guard após um tick para o listener não captar o evento deste signIn
        setTimeout(() => { isManualActionRef.current = false }, 500)
      }
    },
    [setSafeError, setSafeState, setSafeUser, setSafeProfile]
  )

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      profileData: { full_name: string; employee_id?: string }
    ): Promise<{ error: string | null }> => {
      setSafeState('loading')
      setSafeError(null)

      const { user: authUser, error: signUpError } = await authSignUp(email, password, {
        full_name: profileData.full_name,
        employee_id: profileData.employee_id,
      })

      if (signUpError || !authUser) {
        setSafeError(signUpError || 'Erro ao criar conta')
        setSafeState('error')
        return { error: signUpError || 'Erro ao criar conta' }
      }

      setSafeUser(authUser)
      setSafeProfile(null)
      setSafeState('authenticated')
      return { error: null }
    },
    [setSafeError, setSafeState, setSafeUser, setSafeProfile]
  )

  const signOut = useCallback(async (): Promise<void> => {
    isManualActionRef.current = true
    setSafeState('loading')

    try {
      await authSignOut()
    } finally {
      setSafeUser(null)
      setSafeProfile(null)
      setSafeError(null)
      setSafeState('unauthenticated')
      setTimeout(() => { isManualActionRef.current = false }, 500)
    }
  }, [setSafeError, setSafeState, setSafeUser, setSafeProfile])

  const retry = useCallback(() => {
    initializeAuth()
  }, [initializeAuth])

  // ── Context value ────────────────────────────────────────────────────────────
  const value: AuthContextType = {
    user,
    profile,
    loading,
    error,
    isAuthenticated,
    signIn,
    signUp,
    signOut,
    retry,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
export type { AuthContextType }
