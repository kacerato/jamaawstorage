import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { Button, Input, Card, Alert, Spinner } from '../../components/ui'


function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function roleLabel(role: string): string {
  switch (role) {
    case 'supervisor':
      return 'Supervisor'
    case 'leader':
      return 'Lider'
    case 'collaborator':
      return 'Colaborador'
    case 'admin':
      return 'Administrador'
    default:
      return role
  }
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [employeeId, setEmployeeId] = useState(profile?.employee_id ?? '')
  const [isLoading, setIsLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const handleSave = useCallback(async () => {
    if (!profile) return

    setIsLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const updates = { full_name: fullName, employee_id: employeeId || null }
        const { error } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', profile.id)

      if (error) throw error

      setSuccessMessage('Perfil atualizado com sucesso!')

      setTimeout(() => {
        setSuccessMessage('')
      }, 3000)

      await supabase
        .from('profiles')
        .select('*')
        .eq('id', profile.id)
        .single()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao atualizar perfil')
    } finally {
      setIsLoading(false)
    }
  }, [profile, fullName, employeeId])

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Spinner size="lg" />
      </div>
    )
  }

  const initials = getInitials(profile.full_name ?? 'U')

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <Card
        variant="bordered"
        padding="none"
        className="w-full max-w-md overflow-hidden"
      >
        <div
          className="w-full"
          style={{
            background: 'linear-gradient(135deg, #f97316, #c2410c)',
            padding: '10px 0 8px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '3px',
              color: 'rgba(255,255,255,0.85)',
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            ALMOXARIFADO
          </span>
        </div>

        <div className="flex flex-col items-center px-6 pt-6 pb-6">
          <div className="relative mb-3">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 68,
                height: 68,
                background:
                  'linear-gradient(135deg, rgba(249,115,22,0.25), rgba(249,115,22,0.12))',
                border: '2px solid rgba(249,115,22,0.4)',
                fontSize: 24,
                fontWeight: 700,
                color: '#f97316',
                fontFamily: "'Outfit', sans-serif",
                position: 'relative',
                zIndex: 1,
              }}
            >
              {initials}
            </div>
            <div
              className="absolute rounded-full"
              style={{
                inset: -5,
                border: '1.5px dashed rgba(249,115,22,0.2)',
              }}
            />
          </div>

          <h2
            className="mb-4 text-center text-lg font-semibold text-white"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            Editar Perfil
          </h2>

          {successMessage && (
            <Alert variant="success" className="mb-4 w-full">
              {successMessage}
            </Alert>
          )}

          {errorMessage && (
            <Alert variant="danger" className="mb-4 w-full">
              {errorMessage}
            </Alert>
          )}

          <div className="flex w-full flex-col gap-4">
            <Input
              label="Nome completo"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />

            <Input
              label="Matrícula"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-300">E-mail</label>
              <input
                type="text"
                value={user?.email ?? ''}
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-500 opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-300">Função</label>
              <span
                className="inline-block w-fit"
                style={{
                  padding: '3px 10px',
                  background: 'rgba(249,115,22,0.12)',
                  border: '1px solid rgba(249,115,22,0.25)',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#f97316',
                  letterSpacing: '0.4px',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {roleLabel(profile.role ?? 'collaborator')}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-300">Status</label>
              <span
                className="text-sm"
                style={{
                  color: profile.is_active ? '#34d399' : '#f87171',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                {profile.is_active ? 'Ativa' : 'Inativa'}
              </span>
            </div>

            <div className="h-px w-full bg-gray-700/50" />

            <div className="flex gap-3">
              <Button
                variant="primary"
                isLoading={isLoading}
                onClick={handleSave}
                className="flex-1"
              >
                Salvar Alterações
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate(-1)}
                className="flex-1"
              >
                Voltar
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
