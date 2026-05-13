import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Tables, WithdrawalDestinationType } from '../../types/database'
import type { KitWithItems } from '../../types'
import {
  Button,
  Select,
  Card,
  Modal,
  Badge,
  Alert,
  Spinner,
} from '../../components/ui'
import {
  ClipboardIcon,
  UserIcon,
  PackageIcon,
  SignatureIcon,
  CameraIcon,
  KitIcon,
} from '../../components/icons'
import { cn, DEFAULT_IMAGE_UPLOAD_OPTIONS, generateWithdrawalCodePreview, imageFileToDataUrl } from '../../lib/utils'
import { buildPublicStorageUrl, uploadDataUrlToStorage, uploadFileToStorage, uploadImageToStorage } from '../../lib/storage'
import { ItemSelector } from './ItemSelector'
import { KitSelector } from './KitSelector'

type PeopleRow = Tables<'people'>
type WorkSiteRow = Tables<'work_sites'>
type StockItemRow = Tables<'stock_items'>

type EncodedDestination = `work_site:${string}` | `collaborator:${string}`

interface WithdrawalItemEntry {
  entry_id: string
  stock_item_id: string
  lot_id: string | null
  quantity: number
  unit: string
  stock_item: StockItemRow
  destination_type: WithdrawalDestinationType
  collaborator_id: string | null
  work_site_id: string | null
}

interface WithdrawalGroup {
  destination_type: WithdrawalDestinationType
  collaborator_id: string | null
  work_site_id: string | null
  items: WithdrawalItemEntry[]
}

interface SignatureAttachmentState {
  url: string | null
  name: string | null
  error: string | null
  uploading: boolean
}

const DEFAULT_WORKSITE_NAME = 'obra jamaaw'
const SIGNATURE_ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf'

const STEPS = [
  { key: 'destination', label: 'Solicitante e Fluxo', icon: UserIcon },
  { key: 'items', label: 'Itens da Retirada', icon: PackageIcon },
  { key: 'signatures', label: 'Documentacao e Assinaturas', icon: SignatureIcon },
  { key: 'review', label: 'Revisao e Confirmacao', icon: ClipboardIcon },
] as const

function makeEntryDuplicateKey(entry: Pick<WithdrawalItemEntry, 'stock_item_id' | 'destination_type' | 'collaborator_id' | 'work_site_id'>): string {
  return [
    entry.stock_item_id,
    entry.destination_type,
    entry.collaborator_id ?? 'none',
    entry.work_site_id ?? 'none',
  ].join(':')
}

function makeDestinationGroupKey(entry: Pick<WithdrawalItemEntry, 'destination_type' | 'collaborator_id' | 'work_site_id'>): string {
  return [
    entry.destination_type,
    entry.collaborator_id ?? 'none',
    entry.work_site_id ?? 'none',
  ].join(':')
}

function createEntryId(): string {
  return `withdrawal-entry-${crypto.randomUUID()}`
}

function encodeDestination(destinationType: WithdrawalDestinationType, collaboratorId: string | null, workSiteId: string | null): EncodedDestination {
  return destinationType === 'work_site'
    ? `work_site:${workSiteId ?? ''}`
    : `collaborator:${collaboratorId ?? ''}`
}

function decodeDestination(value: string): { destination_type: WithdrawalDestinationType; collaborator_id: string | null; work_site_id: string | null } {
  const [type, id] = value.split(':')

  if (type === 'work_site') {
    return {
      destination_type: 'work_site',
      collaborator_id: null,
      work_site_id: id || null,
    }
  }

  return {
    destination_type: 'collaborator',
    collaborator_id: id || null,
    work_site_id: null,
  }
}

export function NewWithdrawalPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [currentStep, setCurrentStep] = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})

  const [requesters, setRequesters] = useState<PeopleRow[]>([])
  const [collaborators, setCollaborators] = useState<PeopleRow[]>([])
  const [workSites, setWorkSites] = useState<WorkSiteRow[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)

  const [requestedBy, setRequestedBy] = useState<string>('')
  const [draftDestinationType, setDraftDestinationType] = useState<WithdrawalDestinationType>('collaborator')
  const [draftCollaboratorId, setDraftCollaboratorId] = useState<string>('')
  const [defaultWorkSiteId, setDefaultWorkSiteId] = useState<string>('')

  const [items, setItems] = useState<WithdrawalItemEntry[]>([])
  const [showItemSelector, setShowItemSelector] = useState(false)
  const [showKitSelector, setShowKitSelector] = useState(false)

  const [notes, setNotes] = useState<string>('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [supervisorSignature, setSupervisorSignature] = useState<string>('')
  const [requesterSignature, setRequesterSignature] = useState<string>('')
  const [signatureDocument, setSignatureDocument] = useState<SignatureAttachmentState>({
    url: null,
    name: null,
    error: null,
    uploading: false,
  })
  const [signatureProcessingHint, setSignatureProcessingHint] = useState<string | null>(null)

  const [dragActivePhoto, setDragActivePhoto] = useState(false)
  const [dragActiveDoc, setDragActiveDoc] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('people').select('*').eq('is_active', true).in('role', ['leader', 'supervisor']).order('full_name'),
      supabase.from('people').select('*').eq('is_active', true).eq('role', 'collaborator').order('full_name'),
      supabase.from('work_sites').select('*').eq('is_active', true).order('name'),
    ]).then(([requestersRes, collaboratorsRes, workSitesRes]) => {
      if (cancelled) return

      if (requestersRes.data) setRequesters(requestersRes.data as PeopleRow[])
      if (collaboratorsRes.data) setCollaborators(collaboratorsRes.data as PeopleRow[])

      if (workSitesRes.data) {
        const nextWorkSites = workSitesRes.data as WorkSiteRow[]
        setWorkSites(nextWorkSites)

        const defaultWorkSite =
          nextWorkSites.find((workSite) => workSite.name.trim().toLowerCase() === DEFAULT_WORKSITE_NAME.toLowerCase())
          ?? nextWorkSites[0]

        if (defaultWorkSite) {
          setDefaultWorkSiteId(defaultWorkSite.id)
        }
      }

      setLoadingOptions(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!profile || requestedBy || requesters.length === 0) return

    const currentRequester = requesters.find((requester) => requester.profile_id === profile.id)
    if (currentRequester) {
      setRequestedBy(currentRequester.id)
    }
  }, [profile, requestedBy, requesters])

  const selectedEntryKeys = useMemo(
    () => new Set(items.map((item) => makeEntryDuplicateKey(item))),
    [items],
  )

  const destinationOptions = useMemo(
    () => [
      ...(defaultWorkSiteId
        ? [{
            value: encodeDestination('work_site', null, defaultWorkSiteId),
            label: selectedWorkSiteLabel(workSites, defaultWorkSiteId),
          }]
        : []),
      ...collaborators.map((collaborator) => ({
        value: encodeDestination('collaborator', collaborator.id, null),
        label: `${collaborator.full_name}${collaborator.employee_id ? ` (${collaborator.employee_id})` : ''}`,
      })),
    ],
    [collaborators, defaultWorkSiteId, workSites],
  )

  const groups = useMemo<WithdrawalGroup[]>(() => {
    const map = new Map<string, WithdrawalGroup>()

    for (const item of items) {
      const key = makeDestinationGroupKey(item)
      const existing = map.get(key)

      if (existing) {
        existing.items.push(item)
        continue
      }

      map.set(key, {
        destination_type: item.destination_type,
        collaborator_id: item.collaborator_id,
        work_site_id: item.work_site_id,
        items: [item],
      })
    }

    return Array.from(map.values())
  }, [items])

  const createDraftEntry = (stockItem: StockItemRow): WithdrawalItemEntry | null => {
    if (draftDestinationType === 'collaborator' && !draftCollaboratorId) {
      setStepErrors((prev) => ({
        ...prev,
        collaboratorId: 'Escolha um colaborador para itens destinados a inventario individual.',
      }))
      return null
    }

    if (draftDestinationType === 'work_site' && !defaultWorkSiteId) {
      setStepErrors((prev) => ({
        ...prev,
        workSiteId: 'Nenhuma obra padrao ativa esta disponivel.',
      }))
      return null
    }

    return {
      entry_id: createEntryId(),
      stock_item_id: stockItem.id,
      lot_id: null,
      quantity: 1,
      unit: stockItem.unit,
      stock_item: stockItem,
      destination_type: draftDestinationType,
      collaborator_id: draftDestinationType === 'collaborator' ? draftCollaboratorId : null,
      work_site_id: draftDestinationType === 'work_site' ? defaultWorkSiteId : null,
    }
  }

  const handleAddItem = (stockItem: StockItemRow) => {
    const entry = createDraftEntry(stockItem)
    if (!entry) return
    if (selectedEntryKeys.has(makeEntryDuplicateKey(entry))) return

    setItems((prev) => [...prev, entry])
    setStepErrors((prev) => {
      const next = { ...prev }
      delete next.items
      return next
    })
    setShowItemSelector(false)
  }

  const handleAddKit = (kit: KitWithItems) => {
    const newItems: WithdrawalItemEntry[] = []

    for (const kitItem of kit.kit_items) {
      if (!kitItem.stock_items) continue

      const entry = createDraftEntry(kitItem.stock_items)
      if (!entry) return

      entry.quantity = kitItem.quantity

      if (!selectedEntryKeys.has(makeEntryDuplicateKey(entry))) {
        newItems.push(entry)
      }
    }

    setItems((prev) => [...prev, ...newItems])
    setStepErrors((prev) => {
      const next = { ...prev }
      delete next.items
      return next
    })
    setShowKitSelector(false)
  }

  const handleUpdateQuantity = (entryId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.entry_id === entryId ? { ...item, quantity } : item,
      ),
    )
  }

  const handleUpdateDestination = (entryId: string, encodedDestination: string) => {
    const nextDestination = decodeDestination(encodedDestination)

    setItems((prev) => {
      const current = prev.find((item) => item.entry_id === entryId)
      if (!current) return prev

      const updatedEntry = {
        ...current,
        ...nextDestination,
      }

      const duplicateExists = prev.some((item) =>
        item.entry_id !== entryId && makeEntryDuplicateKey(item) === makeEntryDuplicateKey(updatedEntry),
      )

      if (duplicateExists) {
        setStepErrors((existing) => ({
          ...existing,
          items: `Ja existe "${current.stock_item.name}" no destino escolhido. Ajuste a quantidade no item existente.`,
        }))
        return prev
      }

      return prev.map((item) =>
        item.entry_id === entryId
          ? updatedEntry
          : item,
      )
    })
  }

  const handleRemoveItem = (entryId: string) => {
    setItems((prev) => prev.filter((item) => item.entry_id !== entryId))
  }

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profile) return

    try {
      setPhotoError(null)
      setUploadingPhoto(true)
      const result = await uploadImageToStorage({
        file,
        scope: 'withdrawals',
        entityId: profile.id,
        options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
      })
      setPhotoPreview(result)
      setPhotoUrl(result)
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Nao foi possivel enviar a foto.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSignatureDocumentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profile) return

    try {
      setSignatureDocument((prev) => ({ ...prev, uploading: true, error: null }))
      setSignatureProcessingHint(null)

      const url = await uploadFileToStorage({
        file,
        scope: 'withdrawals/signature-document',
        entityId: profile.id,
      })

      const normalizedUrl = buildPublicStorageUrl(url)
      setSignatureDocument({
        url: normalizedUrl,
        name: file.name,
        error: null,
        uploading: true,
      })
      let previewUrl: string | null = null

      try {
        if (file.type.startsWith('image/')) {
          previewUrl = await imageFileToDataUrl(file, DEFAULT_IMAGE_UPLOAD_OPTIONS)
        } else if (file.type === 'application/pdf') {
          previewUrl = await pdfFileToDataUrl(file)
        }

        if (previewUrl) {
          const extracted = await extractSignatureDataUrls(previewUrl)
          setSupervisorSignature(extracted.supervisor)
          setRequesterSignature(extracted.requester)
          setSignatureProcessingHint('Assinaturas extraidas automaticamente do arquivo enviado.')
        } else {
          setSupervisorSignature('')
          setRequesterSignature('')
          setSignatureProcessingHint('Arquivo salvo como comprovante unico. Para extrair as assinaturas, envie imagem ou PDF com os campos visiveis.')
        }
      } catch (processingError) {
        setSupervisorSignature('')
        setRequesterSignature('')
        setSignatureProcessingHint(
          processingError instanceof Error
            ? `${processingError.message} O arquivo foi salvo mesmo assim para os dois campos.`
            : 'O arquivo foi salvo, mas a extracao automatica falhou.',
        )
      }

      setSignatureDocument({
        url: normalizedUrl,
        name: file.name,
        error: null,
        uploading: false,
      })
    } catch (error) {
      setSignatureDocument((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Nao foi possivel enviar arquivo.',
        uploading: false,
      }))
    } finally {
      event.target.value = ''
    }
  }

  const clearSignatureDocument = () => {
    setSignatureDocument({
      url: null,
      name: null,
      error: null,
      uploading: false,
    })
    setSignatureProcessingHint(null)
    setSupervisorSignature('')
    setRequesterSignature('')
  }

  const refreshSelectedItemsQuantities = async () => {
    if (items.length === 0) return items

    const selectedItemIds = Array.from(new Set(items.map((item) => item.stock_item_id)))
    const { data, error } = await supabase
      .from('stock_items')
      .select('id, current_quantity, is_active')
      .in('id', selectedItemIds)

    if (error) {
      throw new Error(error.message)
    }

    const stockMap = new Map(
      ((data ?? []) as Pick<StockItemRow, 'id' | 'current_quantity' | 'is_active'>[]).map((row) => [row.id, row]),
    )

    const nextItems = items.map((item) => {
      const latest = stockMap.get(item.stock_item_id)
      if (!latest) return item

      return {
        ...item,
        stock_item: {
          ...item.stock_item,
          current_quantity: latest.current_quantity,
          is_active: latest.is_active,
        },
      }
    })

    setItems(nextItems)
    return nextItems
  }

  const validateStep = (step: number, itemsSource = items): boolean => {
    const errors: Record<string, string> = {}

    if (step === 0) {
      if (!requestedBy) errors.requestedBy = 'Selecione quem solicitou a retirada'
      if (draftDestinationType === 'collaborator' && !draftCollaboratorId) {
        errors.collaboratorId = 'Selecione um colaborador para usar como destino padrao'
      }
      if (draftDestinationType === 'work_site' && !defaultWorkSiteId) {
        errors.workSiteId = 'Nenhuma obra padrao esta disponivel.'
      }
    }

    if (step === 1) {
      if (itemsSource.length === 0) errors.items = 'Adicione ao menos um item'

      const invalidDestination = itemsSource.find((item) =>
        item.destination_type === 'collaborator' ? !item.collaborator_id : !item.work_site_id,
      )
      if (invalidDestination) {
        errors.items = `Revise o destino do item "${invalidDestination.stock_item.name}".`
      }

      const overStock = itemsSource.find((item) => item.quantity > item.stock_item.current_quantity)
      if (overStock) {
        errors.items = `Quantidade de "${overStock.stock_item.name}" excede o estoque disponivel (${overStock.stock_item.current_quantity} ${overStock.stock_item.unit})`
      }

      const zeroQty = itemsSource.find((item) => item.quantity <= 0)
      if (zeroQty && !errors.items) {
        errors.items = 'Todas as quantidades devem ser maiores que zero'
      }
    }

    setStepErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleNext = async () => {
    let nextItems = items

    if (currentStep === 1) {
      try {
        nextItems = await refreshSelectedItemsQuantities()
      } catch (error) {
        setStepErrors({
          items: error instanceof Error ? error.message : 'Nao foi possivel atualizar o estoque antes de continuar.',
        })
        return
      }
    }

    if (validateStep(currentStep, nextItems)) {
      setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1))
    }
  }

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0))
  }

  const persistSignatureSnapshots = async () => {
    if (!profile) {
      return {
        supervisorSignatureUrl: null,
        requesterSignatureUrl: null,
      }
    }

    const [supervisorSignatureUrl, requesterSignatureUrl] = await Promise.all([
      supervisorSignature
        ? uploadDataUrlToStorage({
            dataUrl: supervisorSignature,
            scope: 'withdrawals/supervisor-signature-print',
            entityId: profile.id,
          })
        : Promise.resolve<string | null>(null),
      requesterSignature
        ? uploadDataUrlToStorage({
            dataUrl: requesterSignature,
            scope: 'withdrawals/requester-signature-print',
            entityId: profile.id,
          })
        : Promise.resolve<string | null>(null),
    ])

    return {
      supervisorSignatureUrl,
      requesterSignatureUrl,
    }
  }

  const notifyTelegram = async (withdrawalIds: string[]) => {
    const { data, error } = await supabase
      .from('withdrawals')
      .select(
        '*, withdrawal_items(*, stock_items(*)), requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*), approved_by_profile:profiles!withdrawals_authorized_by_fkey(*)',
      )
      .in('id', withdrawalIds)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(error.message)
    }

    const response = await fetch('/api/telegram-withdrawal-notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        withdrawals: data ?? [],
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.error ?? 'Falha ao enviar notificacao Telegram.')
    }
  }

  const handleSubmit = async () => {
    if (!profile) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const refreshedItems = await refreshSelectedItemsQuantities()
      const overStock = refreshedItems.find((item) => item.quantity > item.stock_item.current_quantity)

      if (overStock) {
        setSubmitError(
          `O estoque de "${overStock.stock_item.name}" mudou durante a retirada. Disponivel agora: ${overStock.stock_item.current_quantity} ${overStock.stock_item.unit}.`,
        )
        setCurrentStep(1)
        setSubmitting(false)
        return
      }

      const {
        supervisorSignatureUrl,
        requesterSignatureUrl,
      } = await persistSignatureSnapshots()

      const createdIds: string[] = []

      for (const group of groups) {
        const { data: withdrawalId, error: withdrawalError } = await supabase.rpc('create_completed_withdrawal', {
          p_requested_by: requestedBy,
          p_destination_type: group.destination_type,
          p_collaborator_id: group.destination_type === 'collaborator' ? group.collaborator_id : null,
          p_work_site_id: group.destination_type === 'work_site' ? group.work_site_id : null,
          p_authorized_by: profile.id,
          p_notes: notes || null,
          p_photo_url: photoUrl,
          p_supervisor_signature: supervisorSignatureUrl,
          p_requester_signature: requesterSignatureUrl,
          p_witness_signature: null,
          p_items: group.items.map((item) => ({
            stock_item_id: item.stock_item_id,
            lot_id: item.lot_id,
            quantity: item.quantity,
            unit: item.unit,
          })),
        })

        if (withdrawalError || !withdrawalId) {
          const partialPrefix = createdIds.length > 0
            ? `${createdIds.length} retirada(s) ja foram criadas antes da falha. `
            : ''
          setSubmitError(`${partialPrefix}${withdrawalError?.message ?? 'Erro ao criar retirada'}`)
          setSubmitting(false)
          return
        }

        const { error: attachmentUpdateError } = await supabase
          .from('withdrawals')
          .update({
            supervisor_signature_attachment_url: signatureDocument.url,
            supervisor_signature_attachment_name: signatureDocument.name,
            requester_signature_attachment_url: signatureDocument.url,
            requester_signature_attachment_name: signatureDocument.name,
          })
          .eq('id', withdrawalId)

        if (attachmentUpdateError) {
          const partialPrefix = createdIds.length > 0
            ? `${createdIds.length} retirada(s) ja foram criadas antes da falha. `
            : ''
          setSubmitError(`${partialPrefix}${attachmentUpdateError.message}`)
          setSubmitting(false)
          return
        }

        createdIds.push(withdrawalId)
      }

      notifyTelegram(createdIds).catch((notifyError) => {
        console.warn('Telegram notify failed:', notifyError)
      })

      setSubmitting(false)

      if (createdIds.length === 1) {
        navigate(`/withdrawals/${createdIds[0]}`)
        return
      }

      navigate(`/withdrawals?created=${createdIds.length}`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Nao foi possivel concluir a retirada.')
      setSubmitting(false)
    }
  }

  const requesterOptions = requesters.map((requester) => {
    const suffix = requester.employee_id ? ` (${requester.employee_id})` : ''
    const roleLabel = requester.role === 'supervisor' ? 'Supervisor' : 'Lider'
    const currentUserLabel = requester.profile_id === profile?.id ? ' - voce' : ''

    return {
      value: requester.id,
      label: `${requester.full_name}${suffix} - ${roleLabel}${currentUserLabel}`,
    }
  })

  const collaboratorOptions = collaborators.map((collaborator) => ({
    value: collaborator.id,
    label: `${collaborator.full_name}${collaborator.employee_id ? ` (${collaborator.employee_id})` : ''}`,
  }))

  const selectedRequester = requesters.find((requester) => requester.id === requestedBy)

  const renderStepIndicator = () => (
    <div className="mb-8 flex items-center justify-between">
      {STEPS.map((step, idx) => {
        const StepIcon = step.icon
        const isActive = idx === currentStep
        const isCompleted = idx < currentStep

        return (
          <div key={step.key} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                  isActive
                    ? 'bg-orange-500 text-white'
                    : isCompleted
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-800 text-gray-500',
                )}
              >
                <StepIcon size={20} />
              </div>
              <span
                className={cn(
                  'max-w-[80px] text-center text-xs font-medium',
                  isActive
                    ? 'text-orange-400'
                    : isCompleted
                      ? 'text-emerald-400'
                      : 'text-gray-500',
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'mx-2 h-0.5 flex-1',
                  idx < currentStep ? 'bg-emerald-500' : 'bg-gray-800',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )

  const renderStep1 = () => (
    <div className="flex flex-col gap-6">
      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Solicitante e Destino Padrao</h3>

        {loadingOptions ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Select
              label="Solicitante"
              placeholder="Selecione quem solicitou"
              options={requesterOptions}
              value={requestedBy}
              onChange={(event) => {
                setRequestedBy(event.target.value)
                setStepErrors((prev) => {
                  const next = { ...prev }
                  delete next.requestedBy
                  return next
                })
              }}
              error={stepErrors.requestedBy}
            />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-300">Destino padrao para proximos itens</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDraftDestinationType('collaborator')}
                  className={cn(
                    'flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors',
                    draftDestinationType === 'collaborator'
                      ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                      : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600',
                  )}
                >
                  <UserIcon size={18} className="mb-1 mr-2 inline-block" />
                  Inventario individual
                </button>
                <button
                  type="button"
                  onClick={() => setDraftDestinationType('work_site')}
                  className={cn(
                    'flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors',
                    draftDestinationType === 'work_site'
                      ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                      : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600',
                  )}
                >
                  <ClipboardIcon size={18} className="mb-1 mr-2 inline-block" />
                  Obra jamaaw
                </button>
              </div>
            </div>

            {draftDestinationType === 'collaborator' ? (
              <Select
                label="Colaborador padrao"
                placeholder="Selecione o colaborador"
                options={collaboratorOptions}
                value={draftCollaboratorId}
                onChange={(event) => {
                  setDraftCollaboratorId(event.target.value)
                  setStepErrors((prev) => {
                    const next = { ...prev }
                    delete next.collaboratorId
                    return next
                  })
                }}
                error={stepErrors.collaboratorId}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-4">
                <p className="text-sm font-medium text-orange-300">
                  {selectedWorkSiteLabel(workSites, defaultWorkSiteId)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Itens para obra entram nesse destino por padrao. Depois voce ainda pode trocar item por item.
                </p>
                {stepErrors.workSiteId && (
                  <p className="mt-2 text-sm text-red-400">{stepErrors.workSiteId}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )

  const renderStep2 = () => (
    <div className="flex flex-col gap-6">
      <Card variant="bordered" padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Itens da Retirada</h3>
            <p className="mt-1 text-xs text-gray-500">
              Mesmo formulario, varios destinos. Sistema cria uma retirada por destino no envio final.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<PackageIcon size={16} />}
              onClick={() => setShowItemSelector(true)}
            >
              Adicionar Item
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<KitIcon size={16} />}
              onClick={() => setShowKitSelector(true)}
            >
              Usar Kit
            </Button>
          </div>
        </div>

        {stepErrors.items && (
          <Alert variant="danger" className="mb-4">
            {stepErrors.items}
          </Alert>
        )}

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <PackageIcon size={40} className="mb-2 text-gray-600" />
            <p className="text-sm text-gray-400">
              Nenhum item adicionado. Use os botoes acima para montar a retirada.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Item</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Destino</th>
                  <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Estoque</th>
                  <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Qtd</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Unidade</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-300">Acao</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const entryKey = item.entry_id
                  const isOverStock = item.quantity > item.stock_item.current_quantity
                  const isLowStock = item.stock_item.minimum_quantity > 0 && item.stock_item.current_quantity <= item.stock_item.minimum_quantity

                  return (
                    <tr key={entryKey} className="border-b border-gray-800">
                      <td className="px-3 py-2 text-sm text-white">{item.stock_item.name}</td>
                      <td className="px-3 py-2 text-sm text-gray-400">
                        <select
                          value={encodeDestination(item.destination_type, item.collaborator_id, item.work_site_id)}
                          onChange={(event) => {
                            handleUpdateDestination(entryKey, event.target.value)
                            setStepErrors((prev) => {
                              const next = { ...prev }
                              delete next.items
                              return next
                            })
                          }}
                          className="w-full min-w-[240px] rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                        >
                          {destinationOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={isLowStock ? 'danger' : 'default'} size="sm">
                          {item.stock_item.current_quantity} {item.stock_item.unit}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number"
                          min={1}
                          max={item.stock_item.current_quantity}
                          value={item.quantity}
                          onChange={(event) => {
                            const value = parseInt(event.target.value, 10)
                            if (!Number.isNaN(value) && value >= 0) {
                              handleUpdateQuantity(entryKey, value)
                              setStepErrors((prev) => {
                                const next = { ...prev }
                                delete next.items
                                return next
                              })
                            }
                          }}
                          className={cn(
                            'w-20 rounded border bg-gray-900 px-2 py-1 text-center text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50',
                            isOverStock ? 'border-red-500' : 'border-gray-700',
                          )}
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-300">{item.unit}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(entryKey)}
                          className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                        >
                          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3">
            <span className="text-sm text-gray-400">
              {items.length} item(ns) distribuidos em {groups.length} destino(s)
            </span>
            <span className="text-sm font-medium text-white">
              {items.reduce((sum, item) => sum + item.quantity, 0)} unidades
            </span>
          </div>
        )}
      </Card>

      <Modal
        isOpen={showItemSelector}
        onClose={() => setShowItemSelector(false)}
        title="Adicionar Item"
        size="lg"
      >
        <ItemSelector onSelect={handleAddItem} selectedIds={new Set<string>()} />
      </Modal>

      <Modal
        isOpen={showKitSelector}
        onClose={() => setShowKitSelector(false)}
        title="Selecionar Kit"
        size="lg"
      >
        <KitSelector onSelect={handleAddKit} />
      </Modal>
    </div>
  )

  const renderStep3 = () => (
    <div className="flex flex-col gap-6">
      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Documentacao</h3>

        <div className="mb-6 flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">Observacoes</label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Observacoes adicionais (opcional)"
            rows={3}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          />
        </div>

        <div className="mb-6 flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">
            <CameraIcon size={16} className="mr-1 inline-block" />
            Registro fotografico ou comprovante
          </label>
          {photoPreview ? (
            <div className="relative inline-block">
              <img
                src={photoPreview}
                alt="Registro fotografico"
                className="max-h-48 rounded-lg border border-gray-700"
              />
              <button
                type="button"
                onClick={() => {
                  setPhotoPreview(null)
                  setPhotoUrl(null)
                  setPhotoError(null)
                }}
                className="absolute right-2 top-2 rounded-full bg-red-600 p-1 text-white transition-colors hover:bg-red-700"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
            <div 
              onDragOver={(e) => { e.preventDefault(); setDragActivePhoto(true) }}
              onDragLeave={(e) => { e.preventDefault(); setDragActivePhoto(false) }}
              onDrop={async (e) => {
                e.preventDefault()
                setDragActivePhoto(false)
                const file = e.dataTransfer.files?.[0]
                if (file) {
                  const synthEvent = { target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>
                  await handlePhotoChange(synthEvent)
                }
              }}
              className={cn(
                "rounded-lg border-2 border-dashed p-4 transition-colors",
                dragActivePhoto ? "border-orange-500 bg-orange-500/10" : "border-gray-700 bg-gray-900/50"
              )}
            >
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                disabled={uploadingPhoto}
                className="block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
              />
              <p className="mt-2 text-xs text-gray-500">
                Solte um arquivo aqui ou clique acima. JPG ou PNG, ate {DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB
              </p>
              {uploadingPhoto && <p className="mt-2 text-xs text-orange-300">Enviando imagem...</p>}
            </div>
          )}
          {photoError && <p className="text-xs text-red-400">{photoError}</p>}
        </div>
      </Card>

      <Card variant="bordered" padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Documento com assinaturas</h3>
          <Badge variant="default" size="sm">Upload unico</Badge>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div 
            className={cn(
              "rounded-2xl border border-dashed p-4 transition-colors",
              dragActiveDoc ? "border-orange-500 bg-orange-500/10" : "border-white/8 bg-white/3"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragActiveDoc(true) }}
            onDragLeave={(e) => { e.preventDefault(); setDragActiveDoc(false) }}
            onDrop={async (e) => {
              e.preventDefault()
              setDragActiveDoc(false)
              const file = e.dataTransfer.files?.[0]
              if (file) {
                const synthEvent = { target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>
                await handleSignatureDocumentChange(synthEvent)
              }
            }}
          >
            <label className="text-sm font-medium text-gray-200">
              Envie uma imagem ou PDF que contenha as assinaturas do supervisor e do responsavel
            </label>
            <p className="mt-2 text-xs text-gray-500">
              O mesmo arquivo sera salvo nos dois campos e o sistema tenta extrair a area de assinatura automaticamente.
            </p>

            <input
              type="file"
              accept={SIGNATURE_ATTACHMENT_ACCEPT}
              onChange={(event) => void handleSignatureDocumentChange(event)}
              disabled={signatureDocument.uploading}
              className="mt-4 block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
            />
            <p className="mt-2 text-xs text-gray-500">Solte o arquivo aqui ou clique. Melhor resultado: folha/foto reta, com assinaturas na metade inferior.</p>
            {signatureDocument.uploading && <p className="mt-2 text-xs text-orange-300">Enviando e processando arquivo...</p>}
            {signatureDocument.error && <p className="mt-2 text-xs text-red-400">{signatureDocument.error}</p>}
            {signatureProcessingHint && <p className="mt-2 text-xs text-emerald-300">{signatureProcessingHint}</p>}

            {signatureDocument.url && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{signatureDocument.name ?? 'Arquivo enviado'}</p>
                  <a href={signatureDocument.url} target="_blank" rel="noreferrer" className="text-xs text-orange-300 hover:text-orange-200">
                    Abrir documento compartilhado
                  </a>
                </div>
                <button
                  type="button"
                  onClick={clearSignatureDocument}
                  className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300"
                >
                  Remover
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <SignaturePreview label="Supervisor" value={supervisorSignature} />
            <SignaturePreview label="Responsavel" value={requesterSignature} />
          </div>
        </div>
      </Card>
    </div>
  )

  const renderStep4 = () => (
    <div className="flex flex-col gap-6">
      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Resumo da Operacao</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-gray-400">Codigo previsto</p>
            <p className="text-sm text-white">{generateWithdrawalCodePreview()}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Solicitante</p>
            <p className="text-sm text-white">{selectedRequester?.full_name ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Retiradas que serao criadas</p>
            <p className="text-sm text-white">{groups.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Itens totais</p>
            <p className="text-sm text-white">{items.length}</p>
          </div>
        </div>

        {groups.length > 1 && (
          <Alert variant="warning" className="mt-4">
            Existem {groups.length} destinos diferentes nesta operacao, entao o sistema vai registrar {groups.length} retiradas separadas.
          </Alert>
        )}
      </Card>

      {groups.map((group) => (
        <Card
          key={makeDestinationGroupKey(group)}
          variant="bordered"
          padding="lg"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">{groupTitle(group, collaborators, workSites)}</h3>
              <p className="mt-1 text-xs text-gray-500">{group.items.length} item(ns)</p>
            </div>
            <Badge variant={group.destination_type === 'work_site' ? 'info' : 'primary'} size="sm">
              {group.destination_type === 'work_site' ? 'Obra' : 'Inventario individual'}
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Item</th>
                  <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Qtd</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Unidade</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.entry_id} className="border-b border-gray-800">
                    <td className="px-3 py-2 text-sm text-white">{item.stock_item.name}</td>
                    <td className="px-3 py-2 text-center text-sm text-gray-300">{item.quantity}</td>
                    <td className="px-3 py-2 text-sm text-gray-300">{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {(notes || photoPreview || supervisorSignature || requesterSignature || signatureDocument.url) && (
        <Card variant="bordered" padding="lg">
          <h3 className="mb-4 text-lg font-semibold text-white">Anexos e assinaturas</h3>

          {notes && <p className="mb-4 text-sm text-gray-300">{notes}</p>}

          {photoPreview && (
            <img
              src={photoPreview}
              alt="Registro fotografico"
              className="mb-4 max-h-48 rounded-lg border border-gray-700"
            />
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SignaturePreview label="Supervisor" value={supervisorSignature} />
            <SignaturePreview label="Responsavel" value={requesterSignature} />
          </div>

          {signatureDocument.url && (
            <div className="mt-5">
              <AttachmentPreviewCard label="Documento/Folha compartilhado" url={signatureDocument.url} name={signatureDocument.name} />
            </div>
          )}
        </Card>
      )}

      {submitError && (
        <Alert variant="danger" title="Erro ao criar retirada">
          {submitError}
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={handleBack}>
          Voltar
        </Button>
        <Button
          variant="primary"
          size="lg"
          isLoading={submitting}
          disabled={uploadingPhoto || signatureDocument.uploading}
          onClick={handleSubmit}
          leftIcon={<ClipboardIcon size={20} />}
        >
          Confirmar Retirada
        </Button>
      </div>
    </div>
  )

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return renderStep1()
      case 1:
        return renderStep2()
      case 2:
        return renderStep3()
      case 3:
        return renderStep4()
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Nova Retirada</h2>
          <p className="mt-1 text-sm text-gray-400">
            Monte uma operacao com varios itens e destinos sem poluir o fluxo.
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/withdrawals')}>
          Cancelar
        </Button>
      </div>

      {renderStepIndicator()}
      {renderCurrentStep()}

      {currentStep < 3 && (
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            Voltar
          </Button>
          <Button variant="primary" onClick={handleNext}>
            Proximo
          </Button>
        </div>
      )}
    </div>
  )
}

function selectedWorkSiteLabel(workSites: WorkSiteRow[], workSiteId: string): string {
  const selected = workSites.find((workSite) => workSite.id === workSiteId)
  return selected?.name ?? DEFAULT_WORKSITE_NAME
}

function groupTitle(group: WithdrawalGroup, collaborators: PeopleRow[], workSites: WorkSiteRow[]): string {
  if (group.destination_type === 'work_site') {
    return selectedWorkSiteLabel(workSites, group.work_site_id ?? '')
  }

  const collaborator = collaborators.find((item) => item.id === group.collaborator_id)
  return collaborator?.full_name ?? 'Colaborador'
}

function SignaturePreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/10 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400">{label}</p>
      {value ? (
        <img src={value} alt={`Assinatura ${label}`} className="mt-3 h-24 w-full rounded-lg border border-gray-700 bg-white object-contain p-2" />
      ) : (
        <span className="mt-3 block text-xs text-gray-500">Aguardando extracao</span>
      )}
    </div>
  )
}

function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)
}

function AttachmentPreviewCard({
  label,
  url,
  name,
}: {
  label: string
  url: string | null
  name: string | null
}) {
  if (!url) return null

  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">{label}</p>
      <p className="mt-2 truncate text-sm text-white">{name ?? 'Anexo enviado'}</p>
      {isImageUrl(url) ? (
        <img src={buildPublicStorageUrl(url)} alt={label} className="mt-3 max-h-48 rounded-lg border border-gray-700" />
      ) : null}
      <a href={buildPublicStorageUrl(url)} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-orange-300 hover:text-orange-200">
        Abrir anexo
      </a>
    </div>
  )
}

async function pdfFileToDataUrl(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
  } as Parameters<typeof pdfjs.getDocument>[0])
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 1.6 })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Nao foi possivel processar a primeira pagina do PDF.')
  }

  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
  } as Parameters<typeof page.render>[0]).promise

  return canvas.toDataURL('image/jpeg', 0.9)
}

async function extractSignatureDataUrls(sourceDataUrl: string): Promise<{ supervisor: string; requester: string }> {
  const image = await loadImageFromDataUrl(sourceDataUrl)
  const leftArea = findSignatureFieldArea(image, 'left')
  const rightArea = findSignatureFieldArea(image, 'right')
  const leftCrop = await cropFieldZone(image, leftArea)
  const rightCrop = await cropFieldZone(image, rightArea)

  return {
    supervisor: leftCrop,
    requester: rightCrop,
  }
}

async function cropFieldZone(
  image: HTMLImageElement,
  area: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Nao foi possivel montar o campo de assinatura.')
  }

  canvas.width = Math.max(area.width, 1)
  canvas.height = Math.max(area.height, 1)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  )

  return canvas.toDataURL('image/png')
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Nao foi possivel ler a imagem enviada.'))
    image.src = dataUrl
  })
}

function findSignatureFieldArea(
  image: HTMLImageElement,
  side: 'left' | 'right',
): { x: number; y: number; width: number; height: number } {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    return buildFallbackSignatureArea(width, height, side)
  }

  canvas.width = width
  canvas.height = height
  context.drawImage(image, 0, 0, width, height)

  const halfArea = side === 'left'
    ? {
        x: Math.floor(width * 0.02),
        y: Math.floor(height * 0.3),
        width: Math.floor(width * 0.47),
        height: Math.floor(height * 0.6),
      }
    : {
        x: Math.floor(width * 0.49),
        y: Math.floor(height * 0.3),
        width: Math.floor(width * 0.39),
        height: Math.floor(height * 0.6),
      }

  const handwritingBounds = findHandwritingBounds(context, halfArea)
  if (!handwritingBounds) {
    return buildFallbackSignatureArea(width, height, side)
  }

  const topBorderY = findHorizontalBorder(context, halfArea, handwritingBounds.minY, 'up')
  const bottomBorderY = findHorizontalBorder(context, halfArea, handwritingBounds.maxY, 'down')

  const cropY = Math.max((topBorderY ?? Math.floor(handwritingBounds.minY - handwritingBounds.height * 1.8)) - 8, 0)
  const cropBottom = Math.min((bottomBorderY ?? Math.floor(handwritingBounds.maxY + handwritingBounds.height * 2.1)) + 8, height)

  return {
    x: Math.max(halfArea.x - 6, 0),
    y: cropY,
    width: Math.min(halfArea.width + 12, width - Math.max(halfArea.x - 6, 0)),
    height: Math.max(cropBottom - cropY, 1),
  }
}

function buildFallbackSignatureArea(width: number, height: number, side: 'left' | 'right') {
  if (side === 'left') {
    return {
      x: Math.floor(width * 0.025),
      y: Math.floor(height * 0.275),
      width: Math.floor(width * 0.465),
      height: Math.floor(height * 0.275),
    }
  }

  return {
    x: Math.floor(width * 0.49),
    y: Math.floor(height * 0.275),
    width: Math.floor(width * 0.395),
    height: Math.floor(height * 0.275),
  }
}

function findHandwritingBounds(
  context: CanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number },
): { minY: number; maxY: number; height: number } | null {
  const pixels = context.getImageData(area.x, area.y, area.width, area.height).data
  let minY = Number.POSITIVE_INFINITY
  let maxY = -1
  let hitCount = 0

  for (let y = 0; y < area.height; y += 1) {
    let darkPixelsInRow = 0

    for (let x = 0; x < area.width; x += 1) {
      const offset = (y * area.width + x) * 4
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const alpha = pixels[offset + 3]
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue

      if (alpha > 0 && luminance < 185) {
        darkPixelsInRow += 1
      }
    }

    const rowLooksLikeBorder = darkPixelsInRow > area.width * 0.52
    const rowLooksLikeInk = darkPixelsInRow >= Math.max(6, Math.floor(area.width * 0.015))

    if (!rowLooksLikeBorder && rowLooksLikeInk) {
      hitCount += darkPixelsInRow
      const absoluteY = area.y + y
      if (absoluteY < minY) minY = absoluteY
      if (absoluteY > maxY) maxY = absoluteY
    }
  }

  if (!Number.isFinite(minY) || maxY <= minY || hitCount < 120) {
    return null
  }

  return {
    minY,
    maxY,
    height: maxY - minY,
  }
}

function findHorizontalBorder(
  context: CanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number },
  fromY: number,
  direction: 'up' | 'down',
): number | null {
  const startY = Math.max(area.y, Math.min(fromY, area.y + area.height - 1))
  const endY = direction === 'up' ? area.y : area.y + area.height - 1
  const step = direction === 'up' ? -1 : 1

  for (let y = startY; direction === 'up' ? y >= endY : y <= endY; y += step) {
    let darkPixels = 0
    const rowPixels = context.getImageData(area.x, y, area.width, 1).data

    for (let x = 0; x < area.width; x += 1) {
      const offset = x * 4
      const luminance = 0.2126 * rowPixels[offset] + 0.7152 * rowPixels[offset + 1] + 0.0722 * rowPixels[offset + 2]
      if (rowPixels[offset + 3] > 0 && luminance < 175) {
        darkPixels += 1
      }
    }

    if (darkPixels > area.width * 0.45) {
      return y
    }
  }

  return null
}
