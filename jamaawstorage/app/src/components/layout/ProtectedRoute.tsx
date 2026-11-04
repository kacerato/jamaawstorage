import type { ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { AlertCircle, RefreshCw, Loader2, LogIn } from 'lucide-react'

interface ProtectedRouteProps {
  children: ReactNode
  /* Com requireAdmin, a rota exige o topo da hierarquia. A RLS ja recusaria os
   * dados; o guard existe para nao deixar a pagina montar e falhar em pedacos. */
  requireAdmin?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, profile, loading, error, retry, isAdmin } = useAuth()
  const navigate = useNavigate()
  const isOperator = profile?.role === 'admin' || profile?.role === 'supervisor'
  const accessReason = !profile
    ? 'no_profile'
    : !profile.is_active
    ? 'inactive_profile'
    : !isOperator
    ? 'forbidden_role'
    : null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-void">
        <Loader2 className="h-10 w-10 animate-spin text-ink-dim" />
      </div>
    )
  }

  if (error && !accessReason) {
    const isSessionError = error.toLowerCase().includes('sessão expirada')

    const handleAction = () => {
      if (isSessionError) {
        navigate('/login?reason=session_expired', { replace: true })
      } else {
        retry()
      }
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-void p-4">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-crit/15">
            <AlertCircle className="h-8 w-8 text-crit" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-ink">
              Erro ao carregar
            </h2>
            <p className="text-ink-dim">{error}</p>
          </div>
          <button
            onClick={handleAction}
            className="min-h-touch flex items-center gap-2 rounded-none bg-surface px-6 font-medium text-ink transition-colors hover:bg-void focus:outline-none focus:ring-2 focus:ring-ink/30 focus:ring-offset-2 focus:ring-offset-void"
          >
            {isSessionError ? (
              <>
                <LogIn className="h-4 w-4" />
                Fazer login
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (accessReason) {
    return <Navigate to={`/login?reason=${accessReason}`} replace />
  }

  /* Supervisor autenticado que mira uma rota de administrador volta ao painel,
   * nao para o login: a sessao dele e valida, so o nivel nao alcanca. */
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
