import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { DEFAULT_IMAGE_UPLOAD_OPTIONS, imageFileToDataUrl } from '../../lib/utils'
import { Alert, Button, Card, Input, Spinner } from '../../components/ui'

function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .map((word) => word[0])
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
      return 'Líder'
    case 'collaborator':
      return 'Colaborador'
    default:
      return role
  }
}

export function ProfilePage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { user, profile, retry } = useAuth()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [photoUrl, setPhotoUrl] = useState(profile?.photo_url ?? '')
  const [isLoading, setIsLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const initials = useMemo(() => getInitials(profile?.full_name ?? 'U'), [profile?.full_name])

  const updatePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const dataUrl = await imageFileToDataUrl(file, DEFAULT_IMAGE_UPLOAD_OPTIONS)
      setPhotoUrl(dataUrl)
    } catch (error) {
      console.error(error)
    }
  }

  const handleSave = useCallback(async () => {
    if (!profile) return

    setIsLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          photo_url: photoUrl.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id)

      if (error) throw error

      await retry()
      setSuccessMessage('Perfil atualizado com sucesso.')
      window.setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao atualizar perfil')
    } finally {
      setIsLoading(false)
    }
  }, [fullName, photoUrl, profile, retry])

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <Card variant="bordered" padding="none" className="w-full max-w-md overflow-hidden">
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

        <div className="flex flex-col items-center px-6 pb-6 pt-6">
          <div className="relative mb-4">
            <div className="relative flex h-[78px] w-[78px] items-center justify-center overflow-hidden rounded-full border-2 border-orange-400/40 bg-orange-500/12">
              {photoUrl ? (
                <img src={photoUrl} alt={fullName || 'Supervisor'} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-orange-300">{initials}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 rounded-full border border-white/10 bg-[#18191d] px-2 py-1 text-[11px] font-medium text-orange-200 transition-colors hover:bg-[#202228]"
            >
              Foto
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={updatePhoto}
              className="hidden"
            />
          </div>

          <h2 className="mb-4 text-center text-lg font-semibold text-white" style={{ fontFamily: "'Outfit', sans-serif" }}>
            Editar Perfil
          </h2>

          {successMessage && <Alert variant="success" className="mb-4 w-full">{successMessage}</Alert>}
          {errorMessage && <Alert variant="danger" className="mb-4 w-full">{errorMessage}</Alert>}

          <div className="flex w-full flex-col gap-4">
            <Input label="Nome completo" value={fullName} onChange={(event) => setFullName(event.target.value)} />

            <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-3">
              <p className="text-sm font-medium text-gray-200">Matrícula</p>
              <p className="mt-1 text-sm text-orange-300">{profile.employee_id ?? 'Gerada pelo sistema'}</p>
              <p className="mt-1 text-xs text-gray-500">Sequência interna automática do supervisor</p>
            </div>

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
              <span className="inline-block w-fit rounded-full border border-orange-400/25 bg-orange-500/12 px-3 py-1 text-[11px] font-semibold tracking-[0.04em] text-orange-200">
                {roleLabel(profile.role ?? 'supervisor')}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-300">Status</label>
              <span className="text-sm" style={{ color: profile.is_active ? '#34d399' : '#f87171' }}>
                {profile.is_active ? 'Ativa' : 'Inativa'}
              </span>
            </div>

            <div className="h-px w-full bg-gray-700/50" />

            <div className="flex gap-3">
              <Button variant="primary" isLoading={isLoading} onClick={handleSave} className="flex-1">
                Salvar alterações
              </Button>
              <Button variant="secondary" onClick={() => navigate(-1)} className="flex-1">
                Voltar
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
