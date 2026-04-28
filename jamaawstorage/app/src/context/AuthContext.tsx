import { createContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import type { Tables, TablesInsert } from '../types/database'
import { supabase } from '../lib/supabase'

interface AuthContextType {
  user: User | null
  profile: Tables<'profiles'> | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    profileData: { full_name: string; employee_id?: string }
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

type ProfileRow = Tables<'profiles'>
type ProfileInsert = TablesInsert<'profiles'>

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (userId: string): Promise<ProfileRow | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single<ProfileRow>()

    if (error) {
      console.error('Error fetching profile:', error.message)
      return null
    }

    if (!data) {
      return null
    }

    if (data.role !== 'supervisor' || !data.is_active) {
      console.error('Access denied: only active supervisor accounts are allowed')
      await supabase.auth.signOut()
      return null
    }

    return data
  }, [])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: string, session: Session | null) => {
        setLoading(true)
        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser) {
          const fetchedProfile = await fetchProfile(currentUser.id)
          setProfile(fetchedProfile)
        } else {
          setProfile(null)
        }

        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        return { error: error.message }
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
      })

      if (authError) {
        return { error: authError.message }
      }

      if (!authData.user) {
        return { error: 'Failed to create user account' }
      }

      const newProfile: ProfileInsert = {
        id: authData.user.id,
        full_name: profileData.full_name,
        employee_id: profileData.employee_id ?? null,
        role: 'supervisor',
        is_active: true,
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .insert(newProfile as never)

      if (profileError) {
        return { error: profileError.message }
      }

      return { error: null }
    },
    []
  )

  const signOut = useCallback(async (): Promise<void> => {
    setUser(null)
    setProfile(null)
    await supabase.auth.signOut()
  }, [])

  const value: AuthContextType = {
    user,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext, AuthProvider }
