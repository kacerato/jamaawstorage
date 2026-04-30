import { createContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Tables } from '../types/database'
import {
  signIn as authSignIn,
  signUp as authSignUp,
  signOut as authSignOut,
  createSupervisor as authCreateSupervisor,
  fetchProfile,
  onAuthStateChange,
} from '../services/authService'

type ProfileRow = Tables<'profiles'>

interface AuthContextType {
  user: User | null
  profile: ProfileRow | null
  loading: boolean
  error: string | null
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, metadata?: Record<string, unknown>) => Promise<{ error: string | null }>
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
  const initialized = useRef(false)

  const isAuthenticated = !!user && !!profile

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const unsubscribe = onAuthStateChange((session) => {
      if (!session) {
        setUser(null)
        setProfile(null)
      } else {
        setUser(session.user)
        setProfile(session.profile)
      }
      setLoading(false)
      setError(null)
    })
    return () => { unsubscribe() }
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
      const userProfile = await fetchProfile(authUser.id)
      setUser(authUser)
      setProfile(userProfile)
      setLoading(false)
      return { error: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao fazer login'
      setError(msg)
      setLoading(false)
      return { error: msg }
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, metadata?: Record<string, unknown>) => {
    setError(null)
    try {
      const { user: authUser, error: signUpError } = await authSignUp(email, password, metadata)
      if (signUpError || !authUser) {
        const msg = signUpError || 'Erro ao criar conta'
        setError(msg)
        return { error: msg }
      }
      return { error: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao criar conta'
      setError(msg)
      return { error: msg }
    }
  }, [])

  const signOut = useCallback(async () => {
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
    initialized.current = false
    setLoading(true)
    setError(null)
    void onAuthStateChange((session) => {
      if (!session) {
        setUser(null)
        setProfile(null)
      } else {
        setUser(session.user)
        setProfile(session.profile)
      }
      setLoading(false)
      setError(null)
    })
  }, [])

  const value: AuthContextType = {
    user, profile, loading, error, isAuthenticated,
    signIn, signUp, signOut, createSupervisor, retry,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
export type { AuthContextType }
