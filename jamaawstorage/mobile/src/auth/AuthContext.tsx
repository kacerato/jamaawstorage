import type { Session } from '@supabase/supabase-js'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { startAutoRefreshLifecycle, supabase } from '../lib/supabase'
import type { ProfileRow } from '../data/database.types'

/**
 * Autenticacao.
 *
 * Mesma regra de acesso do painel web (app/src/context/AuthContext.tsx):
 * a conta precisa ter perfil, papel de supervisor e estar ativa. A sessao
 * persiste no keystore do aparelho via expo-secure-store, entao o supervisor
 * nao digita senha a cada abertura.
 *
 * Diferenca em relacao ao web: nao existe criacao de conta aqui. O app e
 * somente leitura e usa as contas que o painel ja administra.
 *
 * A sessao de Hierarquia de supervisores pode introduzir papel de admin e
 * mudar as politicas. ALLOWED_ROLES abaixo e o unico ponto a ajustar: hoje
 * o enum app_role no banco tem 'supervisor' e 'admin'.
 */

const ALLOWED_ROLES: ProfileRow['role'][] = ['supervisor', 'admin']

interface AuthValue {
  session: Session | null
  profile: ProfileRow | null
  /** Verificando a sessao guardada na abertura do app. */
  initializing: boolean
  /** Erro de credencial ou de permissao, em texto para a tela. */
  error: string | null
  signingIn: boolean
  authorized: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function accessError(profile: ProfileRow | null): string | null {
  if (!profile) {
    return 'Perfil não encontrado para esta conta. Fale com o administrador.'
  }
  if (!ALLOWED_ROLES.includes(profile.role)) {
    return 'Esta conta não tem permissão de supervisor.'
  }
  if (!profile.is_active) {
    return 'Esta conta ainda não está ativa. Fale com o administrador.'
  }
  return null
}

function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase()

  if (normalized.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'E-mail ainda não confirmado.'
  }
  if (normalized.includes('conexao') || normalized.includes('conexão') || normalized.includes('network')) {
    return 'Sem conexão com o servidor.'
  }
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error: queryError } = await supabase
      .from('profiles')
      .select('id, full_name, employee_id, role, sector, photo_url, is_active')
      .eq('id', userId)
      .maybeSingle()

    if (queryError) throw new Error(queryError.message)
    return data ?? null
  }, [])

  const syncSession = useCallback(
    async (nextSession: Session | null) => {
      if (!nextSession?.user) {
        setSession(null)
        setProfile(null)
        return
      }

      try {
        const nextProfile = await loadProfile(nextSession.user.id)
        if (!mountedRef.current) return

        const denied = accessError(nextProfile)

        if (denied) {
          // Conta valida no Auth mas sem permissao: encerra a sessao para
          // nao deixar o app em um limbo onde cada consulta volta vazia
          // por RLS e parece bug de dados.
          setError(denied)
          setSession(null)
          setProfile(null)
          await supabase.auth.signOut()
          return
        }

        setSession(nextSession)
        setProfile(nextProfile)
        setError(null)
      } catch (err) {
        if (!mountedRef.current) return
        // Falha de rede ao buscar o perfil nao deve derrubar uma sessao
        // valida: o supervisor pode estar sem sinal. Mantem a sessao e
        // deixa as telas mostrarem seu proprio cache.
        setSession(nextSession)
        setError(err instanceof Error ? friendlyAuthError(err.message) : 'Erro ao carregar perfil.')
      }
    },
    [loadProfile],
  )

  useEffect(() => {
    const stopLifecycle = startAutoRefreshLifecycle()

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        await syncSession(data.session)
      } catch {
        if (mountedRef.current) setError('Não foi possível verificar a sessão.')
      } finally {
        if (mountedRef.current) setInitializing(false)
      }
    })()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        setSession(null)
        setProfile(null)
        return
      }
      // TOKEN_REFRESHED nao precisa reconsultar o perfil.
      if (event === 'TOKEN_REFRESHED') {
        setSession(nextSession)
        return
      }
      void syncSession(nextSession)
    })

    return () => {
      subscription.unsubscribe()
      stopLifecycle()
    }
  }, [syncSession])

  const signIn = useCallback(async (email: string, password: string) => {
    setSigningIn(true)
    setError(null)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (signInError) {
        setError(friendlyAuthError(signInError.message))
      }
      // Sucesso: onAuthStateChange cuida de carregar o perfil.
    } catch (err) {
      setError(err instanceof Error ? friendlyAuthError(err.message) : 'Erro ao entrar.')
    } finally {
      if (mountedRef.current) setSigningIn(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      setSession(null)
      setProfile(null)
      setError(null)
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      initializing,
      error,
      signingIn,
      authorized: Boolean(session && profile && accessError(profile) == null),
      signIn,
      signOut,
    }),
    [session, profile, initializing, error, signingIn, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return context
}
