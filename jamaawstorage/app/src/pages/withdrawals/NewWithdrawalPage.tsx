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
  InfoTip,
  SectionLabel,
} from '../../components/ui'
import {
  ClipboardIcon,
  UserIcon,
  PackageIcon,
  SignatureIcon,
  KitIcon,
} from '../../components/icons'
import { cn, DEFAULT_IMAGE_UPLOAD_OPTIONS, generateWithdrawalCodePreview } from '../../lib/utils'
import { uploadImageToStorage, validateWithdrawalPdf } from '../../lib/storage'
import { ItemSelector } from './ItemSelector'
import { KitSelector } from './KitSelector'
import {
  buildDraftWithdrawalTermDocuments,
  downloadIndividualWithdrawalTermPdfs,
  downloadWithdrawalTermPdf,
} from './withdrawalTermPdf'
import { registerWithdrawalPdf } from './withdrawalDocuments'

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

interface WithdrawalComposition {
  newQty: number
  usedQty: number
  damagedQty: number
  missingQty: number
}

interface WithdrawalCompositionWarning {
  entryId: string
  itemName: string
  unit: string
  quantity: number
  composition: WithdrawalComposition
}

interface PhotoAttachment {
  id: string
  url: string
  previewUrl: string
}

const DEFAULT_WORKSITE_NAME = 'obra jamaaw'
const SIGNED_DOCUMENT_ACCEPT = '.pdf,application/pdf'

const STEPS = [
  { key: 'destination', label: 'Solicitante e Fluxo', icon: UserIcon },
  { key: 'items', label: 'Itens da Retirada', icon: PackageIcon },
  { key: 'signatures', label: 'Documentos Individuais', icon: SignatureIcon },
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

function numericQuantity(value: number | null | undefined): number {
  return Math.max(0, Number(value ?? 0))
}

function buildWithdrawalComposition(stockItem: StockItemRow, quantity: number): WithdrawalComposition {
  const requested = Math.max(0, Number(quantity) || 0)
  const newQty = Math.min(requested, numericQuantity(stockItem.quantity_new))
  const remainingAfterNew = requested - newQty
  const usedQty = Math.min(remainingAfterNew, numericQuantity(stockItem.quantity_used))
  const remainingAfterUsed = remainingAfterNew - usedQty
  const damagedQty = Math.min(remainingAfterUsed, numericQuantity(stockItem.quantity_damaged))

  return {
    newQty,
    usedQty,
    damagedQty,
    missingQty: Math.max(0, remainingAfterUsed - damagedQty),
  }
}

function compositionNeedsConfirmation(composition: WithdrawalComposition): boolean {
  return composition.usedQty > 0 || composition.damagedQty > 0
}

function findStockTotalError(itemsSource: WithdrawalItemEntry[]): string | null {
  const totals = new Map<string, { item: WithdrawalItemEntry; quantity: number }>()

  for (const item of itemsSource) {
    const current = totals.get(item.stock_item_id)
    totals.set(item.stock_item_id, {
      item,
      quantity: (current?.quantity ?? 0) + item.quantity,
    })
  }

  for (const { item, quantity } of totals.values()) {
    if (quantity > item.stock_item.current_quantity) {
      return `Quantidade total de "${item.stock_item.name}" excede o estoque disponivel (${item.stock_item.current_quantity} ${item.stock_item.unit}).`
    }
  }

  return null
}

function buildCompositionWarningsByStockItem(itemsSource: WithdrawalItemEntry[]): WithdrawalCompositionWarning[] {
  const totals = new Map<string, { item: WithdrawalItemEntry; quantity: number }>()

  for (const item of itemsSource) {
    const current = totals.get(item.stock_item_id)
    totals.set(item.stock_item_id, {
      item,
      quantity: (current?.quantity ?? 0) + item.quantity,
    })
  }

  return Array.from(totals.values()).map(({ item, quantity }) => ({
    entryId: item.stock_item_id,
    itemName: item.stock_item.name,
    unit: item.unit,
    quantity,
    composition: buildWithdrawalComposition(item.stock_item, quantity),
  }))
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
  const [compositionWarnings, setCompositionWarnings] = useState<WithdrawalCompositionWarning[]>([])
  const [showCompositionConfirm, setShowCompositionConfirm] = useState(false)

  const [notes, setNotes] = useState<string>('')
  const [photoAttachments, setPhotoAttachments] = useState<PhotoAttachment[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [signedDocumentFiles, setSignedDocumentFiles] = useState<Record<string, File>>({})
  const [signedDocumentErrors, setSignedDocumentErrors] = useState<Record<string, string>>({})

  const [dragActivePhoto, setDragActivePhoto] = useState(false)

  const availableRequesters = useMemo(
    () => requesters,
    [requesters],
  )

  const loggedSupervisorRequester = useMemo(
    () => availableRequesters.find((requester) => requester.profile_id === profile?.id) ?? null,
    [availableRequesters, profile?.id],
  )

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
    if (!profile || requestedBy || availableRequesters.length === 0) return

    setRequestedBy((loggedSupervisorRequester ?? availableRequesters[0]).id)
  }, [availableRequesters, loggedSupervisorRequester, profile, requestedBy])

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
    setCompositionWarnings([])
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
    setCompositionWarnings([])
    setStepErrors((prev) => {
      const next = { ...prev }
      delete next.items
      return next
    })
    setShowKitSelector(false)
  }

  const handleUpdateQuantity = (entryId: string, quantity: number) => {
    setCompositionWarnings([])
    setItems((prev) =>
      prev.map((item) =>
        item.entry_id === entryId ? { ...item, quantity } : item,
      ),
    )
  }

  const handleUpdateDestination = (entryId: string, encodedDestination: string) => {
    const nextDestination = decodeDestination(encodedDestination)
    setCompositionWarnings([])

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
    setCompositionWarnings([])
    setItems((prev) => prev.filter((item) => item.entry_id !== entryId))
  }

  const handlePhotoFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0 || !profile) return

    try {
      setPhotoError(null)
      setUploadingPhoto(true)
      const uploadedPhotos = await Promise.all(
        files.map(async (file) => {
          const result = await uploadImageToStorage({
            file,
            scope: 'withdrawals',
            entityId: profile.id,
            options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
          })

          return {
            id: crypto.randomUUID(),
            url: result,
            previewUrl: result,
          }
        }),
      )

      setPhotoAttachments((prev) => [...prev, ...uploadedPhotos])
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Nao foi possivel enviar as fotos.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return
    await handlePhotoFiles(event.target.files)
    event.target.value = ''
  }

  const removePhotoAttachment = (photoId: string) => {
    setPhotoAttachments((prev) => prev.filter((photo) => photo.id !== photoId))
    setPhotoError(null)
  }

  const handleSignedDocumentChange = async (scopeKey: string, file: File | undefined) => {
    if (!file) return

    try {
      await validateWithdrawalPdf(file)
      setSignedDocumentFiles((current) => ({ ...current, [scopeKey]: file }))
      setSignedDocumentErrors((current) => {
        const next = { ...current }
        delete next[scopeKey]
        return next
      })
    } catch (error) {
      setSignedDocumentErrors((current) => ({
        ...current,
        [scopeKey]: error instanceof Error ? error.message : 'PDF invalido.',
      }))
    }
  }

  const removeSignedDocument = (scopeKey: string) => {
    setSignedDocumentFiles((current) => {
      const next = { ...current }
      delete next[scopeKey]
      return next
    })
    setSignedDocumentErrors((current) => {
      const next = { ...current }
      delete next[scopeKey]
      return next
    })
  }

  const refreshSelectedItemsQuantities = async () => {
    if (items.length === 0) return items

    const selectedItemIds = Array.from(new Set(items.map((item) => item.stock_item_id)))
    const { data, error } = await supabase
      .from('stock_items')
      .select('id, current_quantity, is_active, quantity_new, quantity_used, quantity_damaged')
      .in('id', selectedItemIds)

    if (error) {
      throw new Error(error.message)
    }

    const stockMap = new Map(
      ((data ?? []) as Pick<StockItemRow, 'id' | 'current_quantity' | 'is_active' | 'quantity_new' | 'quantity_used' | 'quantity_damaged'>[]).map((row) => [row.id, row]),
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
          quantity_new: latest.quantity_new,
          quantity_used: latest.quantity_used,
          quantity_damaged: latest.quantity_damaged,
        },
      }
    })

    setItems(nextItems)
    return nextItems
  }

  const validateStep = (step: number, itemsSource = items): boolean => {
    const errors: Record<string, string> = {}

    if (step === 0) {
      if (!requestedBy || !availableRequesters.some((requester) => requester.id === requestedBy)) {
        errors.requestedBy = 'Selecione o lider ou supervisor que pediu a retirada'
      }
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

      const stockTotalError = findStockTotalError(itemsSource)
      if (stockTotalError) {
        errors.items = stockTotalError
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

  const notifyTelegram = async (withdrawalIds: string[]) => {
    const { data, error } = await supabase
      .from('withdrawals')
      .select(
        '*, withdrawal_items(*, stock_items(*), collaborator:people!withdrawal_items_collaborator_id_fkey(id, full_name, employee_id), work_site:work_sites!withdrawal_items_work_site_id_fkey(id, name)), document_requirements:withdrawal_document_requirements(id, status), requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*), approved_by_profile:profiles!withdrawals_authorized_by_fkey(*)',
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

  const handleSubmit = async (options?: { skipCompositionConfirmation?: boolean }) => {
    if (!profile) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const refreshedItems = await refreshSelectedItemsQuantities()
      const stockTotalError = findStockTotalError(refreshedItems)

      if (stockTotalError) {
        setSubmitError(stockTotalError)
        setCurrentStep(1)
        setSubmitting(false)
        return
      }

      const nextCompositions = buildCompositionWarningsByStockItem(refreshedItems)
      const invalidComposition = nextCompositions.find((warning) => warning.composition.missingQty > 0)

      if (invalidComposition) {
        setSubmitError(
          `O estoque por estado de "${invalidComposition.itemName}" nao fecha com a quantidade pedida. Faltam ${invalidComposition.composition.missingQty} ${invalidComposition.unit}.`,
        )
        setCurrentStep(1)
        setSubmitting(false)
        return
      }

      const nextCompositionWarnings = nextCompositions.filter((warning) => compositionNeedsConfirmation(warning.composition))

      if (nextCompositionWarnings.length > 0 && !options?.skipCompositionConfirmation) {
        setCompositionWarnings(nextCompositionWarnings)
        setShowCompositionConfirm(true)
        setCurrentStep(1)
        setSubmitting(false)
        return
      }

      const photoUrls = photoAttachments.map((photo) => photo.url)
      const mainPhotoUrl = photoUrls[0] ?? null
      const primaryGroup = groups[0]
      const requesterId = requestedBy

      if (!requesterId) {
        setSubmitError('Selecione o lider ou supervisor que pediu a retirada.')
        setCurrentStep(0)
        setSubmitting(false)
        return
      }

      const { data: withdrawalId, error: withdrawalError } = await supabase.rpc('create_completed_withdrawal', {
        p_requested_by: requesterId,
        p_destination_type: primaryGroup.destination_type,
        p_collaborator_id: primaryGroup.destination_type === 'collaborator' ? primaryGroup.collaborator_id : null,
        p_work_site_id: primaryGroup.destination_type === 'work_site' ? primaryGroup.work_site_id : null,
        p_authorized_by: profile.id,
        p_notes: notes || null,
        p_photo_url: mainPhotoUrl,
        p_supervisor_signature: null,
        p_requester_signature: null,
        p_witness_signature: null,
        p_items: refreshedItems.map((item) => ({
          stock_item_id: item.stock_item_id,
          lot_id: item.lot_id,
          quantity: item.quantity,
          unit: item.unit,
          destination_type: item.destination_type,
          collaborator_id: item.destination_type === 'collaborator' ? item.collaborator_id : null,
          work_site_id: item.destination_type === 'work_site' ? item.work_site_id : null,
        })),
      })

      if (withdrawalError || !withdrawalId) {
        setSubmitError(withdrawalError?.message ?? 'Erro ao criar retirada')
        setSubmitting(false)
        return
      }

      const postCreateWarnings: string[] = []
      const { error: attachmentUpdateError } = await supabase
        .from('withdrawals')
        .update({
          photo_urls: photoUrls,
        })
        .eq('id', withdrawalId)

      if (attachmentUpdateError) {
        postCreateWarnings.push(`As fotos adicionais nao foram vinculadas: ${attachmentUpdateError.message}`)
      }

      const selectedDocumentEntries = Object.entries(signedDocumentFiles)
        .filter(([scopeKey]) => groups.some((group) => makeDestinationGroupKey(group) === scopeKey))

      if (selectedDocumentEntries.length > 0) {
        const { data: requirements, error: requirementsError } = await supabase
          .from('withdrawal_document_requirements')
          .select('*')
          .eq('withdrawal_id', withdrawalId)
          .neq('status', 'not_required')

        if (requirementsError) {
          postCreateWarnings.push(`Os PDFs ficaram pendentes: ${requirementsError.message}`)
        } else {
          const requirementByScope = new Map((requirements ?? []).map((requirement) => [requirement.scope_key, requirement]))
          const uploadResults = await Promise.allSettled(
            selectedDocumentEntries.map(async ([scopeKey, file]) => {
              const requirement = requirementByScope.get(scopeKey)
              if (!requirement) throw new Error(`Pendencia nao encontrada para ${scopeKey}.`)
              await registerWithdrawalPdf({ requirement, file })
            }),
          )

          const failedUploads = uploadResults.filter((result) => result.status === 'rejected')
          if (failedUploads.length > 0) {
            postCreateWarnings.push(`${failedUploads.length} PDF(s) nao foram anexados e continuam pendentes.`)
          }
        }
      }

      notifyTelegram([withdrawalId]).catch((notifyError) => {
        console.warn('Telegram notify failed:', notifyError)
      })

      setSubmitting(false)
      const params = new URLSearchParams({ printTerm: '1' })
      if (postCreateWarnings.length > 0) params.set('documentsWarning', postCreateWarnings.join(' '))
      navigate(`/withdrawals/${withdrawalId}?${params.toString()}`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Nao foi possivel concluir a retirada.')
      setSubmitting(false)
    }
  }

  const collaboratorOptions = collaborators.map((collaborator) => ({
    value: collaborator.id,
    label: `${collaborator.full_name}${collaborator.employee_id ? ` (${collaborator.employee_id})` : ''}`,
  }))

  const requesterOptions = availableRequesters.map((requester) => ({
    value: requester.id,
    label: `${requester.full_name}${requester.employee_id ? ` (${requester.employee_id})` : ''}`,
  }))

  const selectedRequester = availableRequesters.find((requester) => requester.id === requestedBy) ?? null

  const termDocuments = useMemo(
    () => buildDraftWithdrawalTermDocuments(groups, {
      requester: selectedRequester,
      collaborators,
      workSites,
    }),
    [collaborators, groups, selectedRequester, workSites],
  )

  const handleGenerateTermPdf = async (mode: 'general' | 'individual') => {
    if (!selectedRequester) {
      setStepErrors((prev) => ({
        ...prev,
        requestedBy: 'Selecione o lider ou supervisor que pediu a retirada',
      }))
      setCurrentStep(0)
      return
    }

    if (items.length === 0) {
      setStepErrors((prev) => ({
        ...prev,
        items: 'Adicione ao menos um item para gerar o termo.',
      }))
      setCurrentStep(1)
      return
    }

    const invalidDestination = items.find((item) =>
      item.destination_type === 'collaborator' ? !item.collaborator_id : !item.work_site_id,
    )

    if (invalidDestination) {
      setStepErrors((prev) => ({
        ...prev,
        items: `Revise o destino do item "${invalidDestination.stock_item.name}".`,
      }))
      setCurrentStep(1)
      return
    }

    if (mode === 'general') {
      await downloadWithdrawalTermPdf(termDocuments, {
        fileName: `termo-retirada-${generateWithdrawalCodePreview()}.pdf`,
      })
      return
    }

    await downloadIndividualWithdrawalTermPdfs(termDocuments)
  }

  const renderTermPdfActions = () => (
    <Card variant="bordered" padding="lg">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Termo de retirada PDF</h3>
          <p className="mt-1 text-sm text-gray-400">
            Gere antes da assinatura. O termo geral cria uma pagina por destino; os individuais baixam um PDF por responsavel.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            leftIcon={<ClipboardIcon size={16} />}
            disabled={items.length === 0}
            onClick={() => void handleGenerateTermPdf('general')}
          >
            PDF Geral
          </Button>
          <Button
            type="button"
            variant="outline"
            leftIcon={<ClipboardIcon size={16} />}
            disabled={items.length === 0}
            onClick={() => void handleGenerateTermPdf('individual')}
          >
            PDFs Individuais
          </Button>
        </div>
      </div>
    </Card>
  )

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
              label="Lider solicitante"
              placeholder="Selecione quem pediu a retirada"
              value={requestedBy}
              onChange={(event) => {
                setRequestedBy(event.target.value)
                setStepErrors((prev) => {
                  const next = { ...prev }
                  delete next.requestedBy
                  return next
                })
              }}
              options={requesterOptions}
              error={stepErrors.requestedBy}
            />

            <div className="flex flex-col gap-2">
              <SectionLabel label="Destino padrao" info="Os proximos itens entram nesse destino. Se precisar, voce pode trocar o destino item por item depois." />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDraftDestinationType('collaborator')}
                  className={cn(
                    'flex-1 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors',
                    draftDestinationType === 'collaborator'
                      ? 'border-orange-400/50 bg-orange-500/14 text-orange-100 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.12)]'
                      : 'border-white/8 bg-gray-900 text-gray-400 hover:border-white/14 hover:bg-white/6',
                  )}
                >
                  <UserIcon size={18} className="mb-1 mr-2 inline-block" />
                  Inventario individual
                </button>
                <button
                  type="button"
                  onClick={() => setDraftDestinationType('work_site')}
                  className={cn(
                    'flex-1 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors',
                    draftDestinationType === 'work_site'
                      ? 'border-orange-400/50 bg-orange-500/14 text-orange-100 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.12)]'
                      : 'border-white/8 bg-gray-900 text-gray-400 hover:border-white/14 hover:bg-white/6',
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
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">Itens da Retirada</h3>
              <InfoTip text="Cada item pode ter destino proprio. Isso permite uma unica retirada com colaboradores e obras diferentes." />
            </div>
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
            <p className="text-sm text-gray-400">Nenhum item adicionado.</p>
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
                  const composition = buildWithdrawalComposition(item.stock_item, item.quantity)
                  const willUseRestrictedStock = compositionNeedsConfirmation(composition)

                  return (
                    <tr key={entryKey} className="border-b border-gray-800">
                      <td className="px-3 py-2 text-sm text-white">
                        <div className="flex flex-col gap-2">
                          <span>{item.stock_item.name}</span>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="success" size="sm">Novo {numericQuantity(item.stock_item.quantity_new)}</Badge>
                            <Badge variant="info" size="sm">Usado {numericQuantity(item.stock_item.quantity_used)}</Badge>
                            <Badge variant="danger" size="sm">Avaria {numericQuantity(item.stock_item.quantity_damaged)}</Badge>
                          </div>
                          {willUseRestrictedStock && (
                            <p className="text-xs text-amber-300">
                              Esta retirada vai usar {composition.usedQty > 0 ? `${composition.usedQty} usado(s)` : ''}
                              {composition.usedQty > 0 && composition.damagedQty > 0 ? ' e ' : ''}
                              {composition.damagedQty > 0 ? `${composition.damagedQty} com avaria` : ''}.
                            </p>
                          )}
                        </div>
                      </td>
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

      <Modal
        isOpen={showCompositionConfirm}
        onClose={() => {
          setShowCompositionConfirm(false)
          setSubmitting(false)
        }}
        title="Confirmar composicao da retirada"
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <Alert variant="warning" title="A retirada usara itens que nao sao novos">
            O sistema sempre prioriza Novo, depois Usado e por ultimo Com avaria. Confirme abaixo antes de continuar.
          </Alert>

          <div className="space-y-3">
            {compositionWarnings.map((warning) => {
              const onlyDamaged = warning.composition.newQty === 0
                && warning.composition.usedQty === 0
                && warning.composition.damagedQty > 0

              return (
                <Card key={warning.entryId} variant="bordered" className="border-white/8 bg-white/3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-white">{warning.itemName}</p>
                      <p className="mt-1 text-sm text-gray-400">
                        Solicitado: {warning.quantity} {warning.unit}
                      </p>
                    </div>
                    {onlyDamaged && (
                      <Badge variant="danger" size="md">
                        Somente avariado
                      </Badge>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="success" size="md">Novo {warning.composition.newQty}</Badge>
                    <Badge variant="info" size="md">Usado {warning.composition.usedQty}</Badge>
                    <Badge variant="danger" size="md">Com avaria {warning.composition.damagedQty}</Badge>
                  </div>
                </Card>
              )
            })}
          </div>

          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCompositionConfirm(false)
                setSubmitting(false)
              }}
            >
              Revisar itens
            </Button>
            <Button
              variant="primary"
              isLoading={submitting}
              onClick={() => {
                setShowCompositionConfirm(false)
                void handleSubmit({ skipCompositionConfirmation: true })
              }}
            >
              Prosseguir com retirada
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )

  const renderStep3 = () => (
    <div className="flex flex-col gap-6">
      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Documentacao</h3>

        <div className="mb-6 flex flex-col gap-2">
          <SectionLabel label="Observacoes" info="Opcional. Use para contexto da retirada, obra, turno ou justificativa." />
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Observacoes adicionais (opcional)"
            rows={3}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          />
        </div>

        <div className="mb-6 flex flex-col gap-2">
          <SectionLabel label="Registro fotografico" info={`Opcional. Envie uma ou varias imagens em JPG/PNG, ate ${DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB por foto.`} />
          <div 
            onDragOver={(e) => { e.preventDefault(); setDragActivePhoto(true) }}
            onDragLeave={(e) => { e.preventDefault(); setDragActivePhoto(false) }}
            onDrop={async (e) => {
              e.preventDefault()
              setDragActivePhoto(false)
              if (e.dataTransfer.files?.length) {
                await handlePhotoFiles(e.dataTransfer.files)
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
              multiple
              onChange={handlePhotoChange}
              disabled={uploadingPhoto}
              className="block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
            />
            {uploadingPhoto && <p className="mt-2 text-xs text-orange-300">Enviando imagem...</p>}
          </div>
          {photoAttachments.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photoAttachments.map((photo, index) => (
                <div key={photo.id} className="relative overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
                  <img
                    src={photo.previewUrl}
                    alt={`Registro fotografico ${index + 1}`}
                    className="h-32 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhotoAttachment(photo.id)}
                    className="absolute right-2 top-2 rounded-full bg-red-600 p-1 text-white transition-colors hover:bg-red-700"
                    aria-label={`Remover registro fotografico ${index + 1}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  {index === 0 && (
                    <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                      Principal
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {photoError && <p className="text-xs text-red-400">{photoError}</p>}
        </div>
      </Card>

      {renderTermPdfActions()}

      <Card variant="bordered" padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">PDFs assinados por pessoa</h3>
            <p className="mt-1 text-sm text-gray-400">
              Opcional. Anexe agora somente os PDFs que ja estiverem assinados; os demais poderao ser enviados depois.
            </p>
          </div>
          <Badge variant="default" size="sm">Opcional</Badge>
        </div>

        <div className="space-y-3">
          {groups.map((group) => {
            const scopeKey = makeDestinationGroupKey(group)
            const file = signedDocumentFiles[scopeKey]
            const responsibleName = group.destination_type === 'collaborator'
              ? collaborators.find((person) => person.id === group.collaborator_id)?.full_name ?? 'Colaborador'
              : selectedRequester?.full_name ?? 'Lider solicitante'

            return (
              <div key={scopeKey} className="rounded-2xl border border-white/8 bg-white/3 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{responsibleName}</p>
                    <p className="mt-1 text-xs text-gray-500">{groupTitle(group, collaborators, workSites)}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="file"
                      accept={SIGNED_DOCUMENT_ACCEPT}
                      onChange={(event) => {
                        void handleSignedDocumentChange(scopeKey, event.target.files?.[0])
                        event.target.value = ''
                      }}
                      className="block max-w-sm text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-500 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-orange-600"
                    />
                    {file && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeSignedDocument(scopeKey)}>
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
                {file && <p className="mt-2 truncate text-xs text-emerald-300">Selecionado: {file.name}</p>}
                {signedDocumentErrors[scopeKey] && <p className="mt-2 text-xs text-red-400">{signedDocumentErrors[scopeKey]}</p>}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )

  const renderStep4 = () => (
    <div className="flex flex-col gap-6">
      {renderTermPdfActions()}

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
            <p className="text-xs font-medium text-gray-400">Destinos nesta retirada</p>
            <p className="text-sm text-white">{groups.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Itens totais</p>
            <p className="text-sm text-white">{items.length}</p>
          </div>
        </div>

        {groups.length > 1 && (
          <Alert variant="warning" className="mt-4">
            Existem {groups.length} destinos diferentes nesta operacao, mas tudo ficara na mesma retirada.
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

      {(notes || photoAttachments.length > 0 || Object.keys(signedDocumentFiles).length > 0) && (
        <Card variant="bordered" padding="lg">
          <h3 className="mb-4 text-lg font-semibold text-white">Anexos e documentos</h3>

          {notes && <p className="mb-4 text-sm text-gray-300">{notes}</p>}

          {photoAttachments.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photoAttachments.map((photo, index) => (
                <img
                  key={photo.id}
                  src={photo.previewUrl}
                  alt={`Registro fotografico ${index + 1}`}
                  className="h-32 w-full rounded-lg border border-gray-700 object-cover"
                />
              ))}
            </div>
          )}

          {Object.keys(signedDocumentFiles).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">PDFs individuais selecionados</p>
              {groups.map((group) => {
                const scopeKey = makeDestinationGroupKey(group)
                const file = signedDocumentFiles[scopeKey]
                if (!file) return null
                return (
                  <div key={scopeKey} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-sm">
                    <span className="truncate text-gray-200">{groupTitle(group, collaborators, workSites)}</span>
                    <span className="ml-3 max-w-[50%] truncate text-emerald-300">{file.name}</span>
                  </div>
                )
              })}
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
          disabled={uploadingPhoto}
          onClick={() => void handleSubmit()}
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
