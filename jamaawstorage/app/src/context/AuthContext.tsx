import { createContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Tables } from '../types/database'
import {
  signIn as authSignIn,
  signOut as authSignOut,
  createSupervisor as authCreateSupervisor,
  fetchProfile,
  onAuthStateChange,
  getSession,
} from '../services/authService'

type ProfileRow = Tables<'profiles'>

interface AuthContextType {
  user: User | null
  profile: ProfileRow | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  createSupervisor: (data: {
    email: string
    password: string
    full_name: string
    employee_id?: string
    sector?: string
  }) => Promise<{ error: string | null }>
  retry: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const INIT_TIMEOUT_MS = 15_000

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const signingOutRef = useRef(false)
  const initIdRef = useRef(0)

  const isAuthenticated = !!user && !!profile

  function initAuth() {
    const myInitId = ++initIdRef.current
    const isStale = () => myInitId !== initIdRef.current
    let hadSession = false

    let timeoutId: ReturnType<typeof setTimeout>

    async function loadSession() {
      if (isStale()) return

      try {
        const result = await getSession()

        if (isStale()) return

        if (result.error) {
          setError(result.error)
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        if (!result.session) {
          setUser(null)
          setProfile(null)
          setError(null)
          setLoading(false)
          return
        }

        hadSession = true
        setUser(result.session.user)
        setProfile(result.session.profile)

        if (result.session.fetchError) {
          setError(result.session.fetchError)
        } else {
          setError(null)
        }
        setLoading(false)
      } catch {
        if (isStale()) return
        setError('Erro ao carregar sessão. Tente novamente.')
        setLoading(false)
      }
    }

    loadSession()

    timeoutId = setTimeout(() => {
      if (isStale()) return
      setError('Tempo esgotado ao carregar. Tente novamente.')
      setLoading(false)
    }, INIT_TIMEOUT_MS)

    const unsubscribe = onAuthStateChange((session, _event) => {
      if (isStale()) return

      clearTimeout(timeoutId)

      if (!session) {
        setUser(null)
        setProfile(null)
        if (hadSession && !signingOutRef.current) {
          setError('Sessão expirada. Faça login novamente.')
        } else {
          setError(null)
        }
        setLoading(false)
        return
      }

      hadSession = true
      setUser(session.user)
      setProfile(session.profile)

      if (session.fetchError) {
        setError(session.fetchError)
      } else {
        setError(null)
      }
      setLoading(false)
    })

    unsubRef.current = unsubscribe
  }

  useEffect(() => {
    initAuth()
    return () => {
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
      ++initIdRef.current
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true)
    setError(null)
    try {
      const { user: authUser, error: signInError } = await authSignIn(email, password)
      if (signInError || !authUser) {
        const msg = signInError || 'Erro ao fazer login'
        setError(msg)
        setLoading(false)
        return { error: msg }
      }

      const { profile: userProfile, error: profileError } = await fetchProfile(authUser.id)
      setUser(authUser)
      setProfile(userProfile)

      if (profileError) {
        setError(profileError)
        setLoading(false)
        return { error: profileError }
      }

      setError(null)
      setLoading(false)
      return { error: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao fazer login'
      setError(msg)
      setLoading(false)
      return { error: msg }
    }
  }, [])

  const signOut = useCallback(async () => {
    signingOutRef.current = true
    setLoading(true)
    try {
      await authSignOut()
    } catch {
      // best-effort: server-side invalidation may fail
    } finally {
      setUser(null)
      setProfile(null)
      setError(null)
      setLoading(false)
      signingOutRef.current = false
    }
  }, [])

  const createSupervisor = useCallback(async (data: {
    email: string
    password: string
    full_name: string
    employee_id?: string
    sector?: string
  }) => {
    const { error: createError } = await authCreateSupervisor(data)
    if (createError) {
      setError(createError)
      return { error: createError }
    }
    return { error: null }
  }, [])

  const retry = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }

    setLoading(true)
    setError(null)

    initAuth()
  }, [])

  const value: AuthContextType = {
    user, profile, loading, error, isAuthenticated,
    signIn, signOut, createSupervisor, retry,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
export type { AuthContextType }
