import type { ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { AlertCircle, RefreshCw, Loader2, LogIn } from 'lucide-react'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, profile, loading, error, retry } = useAuth()
  const navigate = useNavigate()
  const accessReason = !profile
    ? 'no_profile'
    : !profile.is_active
    ? 'inactive_profile'
    : profile.role !== 'supervisor'
    ? 'forbidden_role'
    : null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
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
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950 p-4">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-white">
              Erro ao carregar
            </h2>
            <p className="text-gray-400">{error}</p>
          </div>
          <button
            onClick={handleAction}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950"
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

  return <>{children}</>
}
