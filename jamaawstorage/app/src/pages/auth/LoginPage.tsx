import { useState, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { LogoIcon } from '../../components/icons'
import { Button, Input, Card } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'

export function LoginPage() {
  const { signIn, user, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setError(null)
      setIsSubmitting(true)

      const { error: signInError } = await signIn(email, password)

      if (signInError) {
        setError(signInError)
        setIsSubmitting(false)
      }
    },
    [signIn, email, password],
  )

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500/5 blur-3xl" />

      <Card variant="bordered" padding="lg" className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <LogoIcon size={56} />
          <h1 className="text-2xl font-bold text-orange-500">JamaaW Storage</h1>
          <p className="text-sm text-gray-400">Sistema de gestão de almoxarifado</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="E-mail"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <Input
            label="Senha"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            isLoading={isSubmitting}
            className="w-full"
            size="lg"
          >
            Entrar
          </Button>
        </form>
      </Card>
    </div>
  )
}
