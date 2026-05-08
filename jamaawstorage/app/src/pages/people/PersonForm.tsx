import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { AppRole, Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { DEFAULT_IMAGE_UPLOAD_OPTIONS } from '../../lib/utils'
import { buildPublicStorageUrl, uploadFileToStorage, uploadImageToStorage } from '../../lib/storage'
import { Alert, Button, Input, Select } from '../../components/ui'

interface PersonFormProps {
  person?: Tables<'people'> | null
  onSubmit: (person: Tables<'people'>) => void
  onCancel: () => void
}

type PersonAttachment = {
  name: string
  url: string
}

interface FormState {
  full_name: string
  role: AppRole
  job_title: string
  sector: string
  cpf: string
  photo_url: string
  document_attachments: PersonAttachment[]
}

interface FormErrors {
  full_name?: string
  role?: string
  job_title?: string
  cpf?: string
  form?: string
}

const JOB_TITLE_OPTIONS = [
  { value: 'cabista', label: 'Cabista' },
  { value: 'ajudante de cabista', label: 'Ajudante de cabista' },
]

const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,image/*'

function getAutoEmployeeIdLabel(role: AppRole): string {
  return role === 'leader' ? 'JMW-001' : 'JMW-001'
}

function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11)
}

function formatCpf(value: string): string {
  const digits = normalizeCpf(value)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`
}

function readAttachments(value: unknown): PersonAttachment[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []

    const maybeName = 'name' in entry ? entry.name : null
    const maybeUrl = 'url' in entry ? entry.url : null

    if (typeof maybeName !== 'string' || typeof maybeUrl !== 'string' || !maybeUrl.trim()) {
      return []
    }

    return [{ name: maybeName.trim() || 'Documento', url: maybeUrl.trim() }]
  })
}

function buildInitialDocumentName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || fileName
}

export function PersonForm({ person, onSubmit, onCancel }: PersonFormProps) {
  const { user, profile } = useAuth()
  const isEditing = person != null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<FormState>({
    full_name: '',
    role: 'collaborator',
    job_title: '',
    sector: '',
    cpf: '',
    photo_url: '',
    document_attachments: [],
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!person) return
    setForm({
      full_name: person.full_name,
      role: person.role,
      job_title: person.job_title ?? '',
      sector: person.sector ?? '',
      cpf: formatCpf(person.cpf ?? ''),
      photo_url: person.photo_url ?? '',
      document_attachments: readAttachments(person.document_attachments),
    })
    setPhotoPreview(person.photo_url ?? null)
  }, [person])

  const validate = (): boolean => {
    const next: FormErrors = {}
    const normalizedCpf = normalizeCpf(form.cpf)

    if (form.role === 'collaborator' && !form.job_title) next.job_title = 'Funcao obrigatoria'
    if (!form.full_name.trim()) next.full_name = 'Nome completo e obrigatorio'
    if (!form.role) next.role = 'Cargo e obrigatorio'
    if (normalizedCpf.length > 0 && normalizedCpf.length !== 11) next.cpf = 'CPF deve ter 11 digitos'

    setErrors(next)
    return Object.keys(next).length === 0
  }

  const updatePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profile) return

    try {
      setIsUploadingPhoto(true)
      const uploadedUrl = await uploadImageToStorage({
        file,
        scope: person ? 'people' : 'people-draft',
        entityId: person?.id ?? profile.id,
        options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
      })
      setPhotoPreview(uploadedUrl)
      setForm((prev) => ({ ...prev, photo_url: uploadedUrl }))
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        form: error instanceof Error ? error.message : 'Nao foi possivel enviar a foto.',
      }))
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  const updateDocuments = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0 || !profile) return

    try {
      setIsUploadingDocuments(true)
      setErrors((prev) => ({ ...prev, form: undefined }))

      const uploadedDocuments: PersonAttachment[] = []
      for (const file of files) {
        const uploadedUrl = await uploadFileToStorage({
          file,
          scope: 'people-documents',
          entityId: person?.id ?? profile.id,
        })

        uploadedDocuments.push({
          name: buildInitialDocumentName(file.name),
          url: uploadedUrl,
        })
      }

      setForm((prev) => ({
        ...prev,
        document_attachments: [...prev.document_attachments, ...uploadedDocuments],
      }))
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        form: error instanceof Error ? error.message : 'Nao foi possivel anexar os documentos.',
      }))
    } finally {
      setIsUploadingDocuments(false)
      if (documentInputRef.current) documentInputRef.current.value = ''
    }
  }

  const clearPhoto = () => {
    setPhotoPreview(null)
    setForm((prev) => ({ ...prev, photo_url: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeDocument = (index: number) => {
    setForm((prev) => ({
      ...prev,
      document_attachments: prev.document_attachments.filter((_, currentIndex) => currentIndex !== index),
    }))
  }

  const renameDocument = (index: number, name: string) => {
    setForm((prev) => ({
      ...prev,
      document_attachments: prev.document_attachments.map((document, currentIndex) =>
        currentIndex === index ? { ...document, name } : document,
      ),
    }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate()) return

    if (!user) {
      setErrors((prev) => ({ ...prev, form: 'Sua sessao expirou. Faca login novamente.' }))
      return
    }

    if (!profile) {
      setErrors((prev) => ({ ...prev, form: 'Seu perfil de supervisor nao foi encontrado.' }))
      return
    }

    setIsSubmitting(true)
    setErrors((prev) => ({ ...prev, form: undefined }))

    const payload = {
      full_name: form.full_name.trim(),
      role: form.role,
      job_title: form.role === 'collaborator' ? form.job_title : null,
      sector: form.sector.trim() || null,
      cpf: normalizeCpf(form.cpf) || null,
      photo_url: form.photo_url.trim() || null,
      document_attachments: form.document_attachments
        .map((document) => ({
          ...document,
          name: document.name.trim() || 'Documento',
          url: document.url.trim(),
        }))
        .filter((document) => document.url) as Record<string, unknown>[],
      updated_at: new Date().toISOString(),
    }

    try {
      if (isEditing && person) {
        const updateData: TablesUpdate<'people'> = payload

        const { data, error } = await supabase
          .from('people')
          .update(updateData)
          .eq('id', person.id)
          .select()
          .single<Tables<'people'>>()

        if (error) throw error
        if (data) onSubmit(data)
      } else {
        const insertData: TablesInsert<'people'> = {
          ...payload,
          is_active: true,
          created_by: profile.id,
        }

        const { data, error } = await supabase
          .from('people')
          .insert(insertData)
          .select()
          .single<Tables<'people'>>()

        if (error) throw error
        if (data) onSubmit(data)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar colaborador'
      setErrors((prev) => ({ ...prev, form: message }))
    } finally {
      setIsSubmitting(false)
    }
  }

  const roleOptions = [
    { value: 'leader', label: 'Lider' },
    { value: 'collaborator', label: 'Colaborador' },
  ]

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
          Identidade
        </p>

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex items-center gap-4">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5">
              {photoPreview ? (
                <img src={photoPreview} alt="Foto do colaborador" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="text-xl font-semibold text-orange-300">
                  {form.full_name
                    .split(' ')
                    .map((part) => part[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || 'JW'}
                </span>
              )}
              {photoPreview && (
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm text-white"
                >
                  x
                </button>
              )}
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-500/16"
              >
                Enviar foto
              </button>
              <p className="text-xs text-gray-500">JPG ou PNG, ate {DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={updatePhoto}
                className="hidden"
              />
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-3">
            <p className="text-sm font-medium text-gray-200">Matricula</p>
            <p className="mt-1 text-sm text-orange-300">
              {isEditing ? person?.employee_id ?? 'Gerada automaticamente' : 'Gerada automaticamente ao salvar'}
            </p>
            <p className="mt-1 text-xs text-gray-500">Sequencia padrao do sistema, ex.: {getAutoEmployeeIdLabel(form.role)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          label="Nome completo"
          value={form.full_name}
          onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
          error={errors.full_name}
          required
          placeholder="Ex: Joao da Silva"
        />

        <Input
          label="CPF"
          value={form.cpf}
          onChange={(event) => setForm((prev) => ({ ...prev, cpf: formatCpf(event.target.value) }))}
          error={errors.cpf}
          inputMode="numeric"
          placeholder="000.000.000-00"
        />
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
          Dados profissionais
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Cargo"
            value={form.role}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                role: event.target.value as AppRole,
                job_title: event.target.value === 'leader' ? '' : prev.job_title,
              }))
            }
            options={roleOptions}
            error={errors.role}
            required
          />

          <Input
            label="Setor / Obra padrao"
            value={form.sector}
            onChange={(event) => setForm((prev) => ({ ...prev, sector: event.target.value }))}
            placeholder="Ex: Construcao Civil"
          />

          {form.role === 'collaborator' && (
            <Select
              label="Funcao"
              value={form.job_title}
              onChange={(event) => setForm((prev) => ({ ...prev, job_title: event.target.value }))}
              options={JOB_TITLE_OPTIONS}
              error={errors.job_title}
              placeholder="Selecione a funcao"
              required
            />
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#111215] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">
              Documentos
            </p>
            <p className="mt-2 text-sm text-gray-400">
              Anexe CPF, ficha, contrato ou outros arquivos do colaborador em um bloco separado.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => documentInputRef.current?.click()}
              disabled={isUploadingDocuments}
            >
              {isUploadingDocuments ? 'Enviando documentos...' : 'Anexar documentos'}
            </Button>
            <input
              ref={documentInputRef}
              type="file"
              accept={DOCUMENT_ACCEPT}
              multiple
              onChange={updateDocuments}
              className="hidden"
            />
            <p className="text-xs text-gray-500">PDF, DOC, DOCX ou imagem.</p>
          </div>
        </div>

        {form.document_attachments.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {form.document_attachments.map((document, index) => (
              <div key={`${document.url}-${index}`} className="rounded-2xl border border-white/8 bg-white/4 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <Input
                      label={`Nome do documento ${index + 1}`}
                      value={document.name}
                      onChange={(event) => renameDocument(index, event.target.value)}
                      placeholder="Ex: CPF frente"
                    />
                    <a
                      href={buildPublicStorageUrl(document.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-orange-300 hover:text-orange-200"
                    >
                      Abrir documento
                    </a>
                  </div>
                  <Button type="button" variant="ghost" onClick={() => removeDocument(index)}>
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/3 px-4 py-5 text-sm text-gray-500">
            Nenhum documento anexado ate agora.
          </div>
        )}
      </div>

      {errors.form && <Alert variant="danger">{errors.form}</Alert>}

      <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting} disabled={isUploadingPhoto || isUploadingDocuments}>
          {isEditing ? 'Salvar alteracoes' : 'Cadastrar colaborador'}
        </Button>
      </div>
    </form>
  )
}
