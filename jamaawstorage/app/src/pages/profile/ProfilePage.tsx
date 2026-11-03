import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { DEFAULT_IMAGE_UPLOAD_OPTIONS } from '../../lib/utils'
import { uploadImageToStorage } from '../../lib/storage'
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
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const initials = useMemo(() => getInitials(profile?.full_name ?? 'U'), [profile?.full_name])

  useEffect(() => {
    setFullName(profile?.full_name ?? '')
    setPhotoUrl(profile?.photo_url ?? '')
  }, [profile?.full_name, profile?.photo_url])

  const updatePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profile) return

    try {
      setErrorMessage('')
      setIsUploadingPhoto(true)
      const uploadedUrl = await uploadImageToStorage({
        file,
        scope: 'profiles',
        entityId: profile.id,
        options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
      })
      setPhotoUrl(uploadedUrl)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro ao enviar foto.')
    } finally {
      setIsUploadingPhoto(false)
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
      <div className="flex min-h-screen items-center justify-center bg-void">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-4">
      <Card variant="bordered" padding="none" className="w-full max-w-md overflow-hidden">
        <div
          className="w-full"
          style={{
            background: '#FF5D00',
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
            <div className="relative flex h-[78px] w-[78px] items-center justify-center overflow-hidden rounded-full border-2 border-line bg-surface">
              {photoUrl ? (
                <img src={photoUrl} alt={fullName || 'Supervisor'} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-ink">{initials}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 rounded-none border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-surface"
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

          <h2 className="mb-4 text-center text-lg font-semibold text-ink" style={{ fontFamily: "'Outfit', sans-serif" }}>
            Editar Perfil
          </h2>

          {successMessage && <Alert variant="success" className="mb-4 w-full">{successMessage}</Alert>}
          {errorMessage && <Alert variant="danger" className="mb-4 w-full">{errorMessage}</Alert>}

          <div className="flex w-full flex-col gap-4">
            <Input label="Nome completo" value={fullName} onChange={(event) => setFullName(event.target.value)} />

            <div className="rounded-none border border-dashed border-line bg-surface px-4 py-3">
              <p className="text-sm font-medium text-ink-dim">Matrícula</p>
              <p className="mt-1 text-sm text-ink">{profile.employee_id ?? 'Gerada pelo sistema'}</p>
              <p className="mt-1 text-xs text-ink-mute">Sequência interna automática do supervisor</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink-dim">E-mail</label>
              <input
                type="text"
                value={user?.email ?? ''}
                disabled
                className="w-full cursor-not-allowed rounded-none border border-line bg-surface px-3 py-2 text-sm text-ink-mute opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink-dim">Função</label>
              <span className="inline-block w-fit rounded-none border border-line bg-surface px-3 py-1 text-[11px] font-semibold tracking-[0.04em] text-ink">
                {roleLabel(profile.role ?? 'supervisor')}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink-dim">Status</label>
              <span className="text-sm" style={{ color: profile.is_active ? '#34d399' : '#f87171' }}>
                {profile.is_active ? 'Ativa' : 'Inativa'}
              </span>
            </div>

            <div className="h-px w-full bg-surface" />

            <div className="flex gap-3">
              <Button variant="primary" isLoading={isLoading} onClick={handleSave} className="flex-1" disabled={isUploadingPhoto}>
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
