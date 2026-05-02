import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Tables } from '../types/database'
import {
  signIn as authSignIn,
  signOut as authSignOut,
  createSupervisor as authCreateSupervisor,
  fetchProfile,
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
  retry: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const signingOutRef = useRef(false)
  const userRef = useRef<User | null>(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  const syncSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      setUser(null)
      setProfile(null)
      setError(null)
      return
    }

    const { profile: nextProfile, error: profileError } = await fetchProfile(session.user.id)

    setUser(session.user)
    setProfile((currentProfile) => nextProfile ?? (profileError ? currentProfile : null))
    setError(profileError)
  }, [])

  useEffect(() => {
    let mounted = true

    const runInitialSync = async () => {
      try {
        await syncSession()
      } catch (err) {
        console.error('Auth initialization error:', err)
        if (mounted) setError('Erro ao conectar ao serviço de autenticação.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void runInitialSync()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      window.setTimeout(async () => {
        if (!mounted) return

        if (event === 'SIGNED_OUT' || !session?.user) {
          setUser(null)
          setProfile(null)
          if (!signingOutRef.current) {
            setError(null)
          }
          setLoading(false)
          return
        }

        try {
          await syncSession()
        } catch {
          if (mounted) setError('Erro ao sincronizar sua sessão. Tente novamente.')
        } finally {
          if (mounted) setLoading(false)
        }
      }, 0)
    })

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (!userRef.current) return
      void syncSession()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [syncSession])

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
      await syncSession()
    } catch {
      setError('Erro ao tentar novamente. Verifique sua conexão.')
    } finally {
      setLoading(false)
    }
  }, [syncSession])

  const value: AuthContextType = {
    user,
    profile,
    loading,
    error,
    isAuthenticated: !!user && !!profile,
    signIn,
    signOut,
    createSupervisor,
    retry,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
export type { AuthContextType }
