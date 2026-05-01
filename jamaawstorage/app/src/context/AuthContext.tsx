import { createContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Tables } from '../types/database'
import {
  signIn as authSignIn,
  signOut as authSignOut,
  createSupervisor as authCreateSupervisor,
  onAuthStateChange,
  processSession,
} from '../services/authService'
import { supabase } from '../lib/supabase'

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

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const signingOutRef = useRef(false)

  const isAuthenticated = !!user && !!profile

  useEffect(() => {
    let mounted = true
    let unsubscribe: (() => void) | null = null

    async function initialize() {
      try {
        const { data: { session: supabaseSession } } = await supabase.auth.getSession()

        if (!mounted) return

        if (supabaseSession) {
          const session = await processSession(supabaseSession)
          if (mounted) {
            setUser(session?.user ?? null)
            setProfile(session?.profile ?? null)
            if (session?.fetchError) setError(session.fetchError)
          }
        }
      } catch (err) {
        console.error('Auth initialization error:', err)
        if (mounted) setError('Erro ao conectar ao serviço de autenticação.')
      } finally {
        if (mounted) setLoading(false)
      }

      if (mounted) {
        unsubscribe = onAuthStateChange((session) => {
          if (!mounted) return

          if (!session) {
            setUser(null)
            setProfile(null)
            if (!signingOutRef.current) {
              setError(null)
            }
          } else {
            setUser(session.user)
            setProfile(session.profile)
            setError(session.fetchError ?? null)
          }
          setLoading(false)
        })
      }
    }

    initialize()

    return () => {
      mounted = false
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    const { error: signInError } = await authSignIn(email.trim(), password)
    if (signInError) {
      setError(signInError)
      return { error: signInError }
    }
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    signingOutRef.current = true
    try {
      await authSignOut()
    } catch {
      // best-effort
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

  const retry = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session: supabaseSession } } = await supabase.auth.getSession()
      if (supabaseSession) {
        const session = await processSession(supabaseSession)
        setUser(session?.user ?? null)
        setProfile(session?.profile ?? null)
        if (session?.fetchError) setError(session.fetchError)
      } else {
        setUser(null)
        setProfile(null)
      }
    } catch {
      setError('Erro ao tentar novamente. Verifique sua conexão.')
    } finally {
      setLoading(false)
    }
  }, [])

  const value: AuthContextType = {
    user, profile, loading, error, isAuthenticated,
    signIn, signOut, createSupervisor, retry,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
export type { AuthContextType }