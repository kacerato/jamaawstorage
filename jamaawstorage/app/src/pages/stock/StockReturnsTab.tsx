import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { Tables, TablesInsert } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { buildPublicStorageUrl, uploadFileToStorage, uploadImageToStorage } from '../../lib/storage'
import { cn, DEFAULT_IMAGE_UPLOAD_OPTIONS, formatDateTime, formatQuantity } from '../../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  Modal,
  Select,
  Spinner,
} from '../../components/ui'
import { BuildingIcon, CameraIcon, ClipboardIcon, PackageIcon, UserIcon, NewConditionIcon, UsedConditionIcon, DamagedConditionIcon } from '../../components/icons'
import { StockItemPicker } from '../../components/items/StockItemPicker'
import { ItemVisual } from '../../components/items/ItemVisual'

type StockItemRow = Tables<'stock_items'>
type PersonRow = Tables<'people'>
type WorkSiteRow = Tables<'work_sites'>
type StockReturnRequestRow = Tables<'stock_return_requests'>

type ReturnStatus = StockReturnRequestRow['status']
type ReturnSourceType = StockReturnRequestRow['source_type']

type ReturnRequestWithDetails = StockReturnRequestRow & {
  stock_item: Pick<StockItemRow, 'id' | 'code' | 'name' | 'unit' | 'svg_icon_key'> | null
  source_person: Pick<PersonRow, 'id' | 'full_name' | 'employee_id'> | null
  source_work_site: Pick<WorkSiteRow, 'id' | 'name'> | null
  created_by_profile: { id: string; full_name: string } | null
  approved_by_profile: { id: string; full_name: string } | null
}

type ReturnRowRecord = ReturnRequestWithDetails & Record<string, unknown>
type InventoryGroup = {
  key: string
  stockItemId: string
  stockItemName: string
  stockItemCode: string | null
  stockItemUnit: string
  stockItemIconKey: string | null
  itemCondition: 'used' | 'damaged' | 'new' | 'mixed'
  totalQuantity: number
  entries: ReturnRequestWithDetails[]
}

interface StockReturnsTabProps {
  profileId: string | null
  embedded?: boolean
}

interface ReturnDraftItem {
  stock_item_id: string
  quantity: string
  item_photo_url: string | null
  item_condition: 'used' | 'damaged'
}

interface ReturnFormState {
  items: ReturnDraftItem[]
  source_type: ReturnSourceType
  source_person_id: string
  source_work_site_id: string
  source_details: string
  notes: string
  photo_url: string | null
  document_url: string | null
  document_name: string | null
}

interface ReturnFormErrors {
  items?: string
  source_person_id?: string
  source_work_site_id?: string
  form?: string
}

interface ProcessFormState {
  approve_quantity: string
  hold_quantity: string
  approved_condition: 'new' | 'used' | 'damaged'
  hold_condition: 'used' | 'damaged'
  quick_action: 'return' | 'hold'
  triage_notes: string
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'held', label: 'Mantidos na triagem' },
  { value: 'approved', label: 'Aprovados' },
]

const initialFormState: ReturnFormState = {
  items: [],
  source_type: 'collaborator',
  source_person_id: '',
  source_work_site_id: '',
  source_details: '',
  notes: '',
  photo_url: null,
  document_url: null,
  document_name: null,
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null
  return buildPublicStorageUrl(value)
}

function statusLabel(status: ReturnStatus): string {
  if (status === 'pending') return 'Pendente'
  if (status === 'held') return 'Mantido na triagem'
  return 'Aprovado'
}

function statusVariant(status: ReturnStatus): 'warning' | 'info' | 'success' {
  if (status === 'pending') return 'warning'
  if (status === 'held') return 'info'
  return 'success'
}

function conditionLabel(condition: 'used' | 'damaged' | 'new' | 'mixed'): string {
  if (condition === 'new') return 'Novo'
  if (condition === 'used') return 'Usado'
  if (condition === 'damaged') return 'Com avaria'
  return 'Misto'
}

function conditionVariant(condition: 'used' | 'damaged' | 'new' | 'mixed'): 'success' | 'info' | 'danger' | 'warning' {
  if (condition === 'new') return 'success'
  if (condition === 'used') return 'info'
  if (condition === 'damaged') return 'danger'
  return 'warning'
}

function conditionDescription(condition: 'used' | 'damaged'): string {
  if (condition === 'used') return 'Pronto para limpeza, revisao ou nova liberacao.'
  return 'Precisa avaliacao tecnica, reparo ou descarte.'
}

function stockConditionLabel(condition: 'new' | 'used' | 'damaged'): string {
  if (condition === 'new') return 'Novo'
  if (condition === 'used') return 'Usado'
  return 'Com avaria'
}

function resolvedApprovedCondition(row: ReturnRequestWithDetails): 'new' | 'used' | 'damaged' | null {
  return row.approved_condition ?? null
}

function sourceLabel(row: ReturnRequestWithDetails): string {
  if (row.source_type === 'collaborator') {
    const person = row.source_person
    if (!person) return 'Colaborador'
    return person.employee_id ? `${person.full_name} (${person.employee_id})` : person.full_name
  }

  return row.source_work_site?.name ?? 'Obra'
}

function buildInventoryGroups(
  requests: ReturnRequestWithDetails[],
  quantitySelector: (row: ReturnRequestWithDetails) => number,
  conditionSelector: (row: ReturnRequestWithDetails) => 'used' | 'damaged' | 'new',
): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>()

  requests.forEach((row) => {
    const quantity = quantitySelector(row)
    if (quantity <= 0) return

    const groupCondition = conditionSelector(row)
    const key = `${row.stock_item_id}:${groupCondition}`
    const existing = groups.get(key)

    if (existing) {
      existing.totalQuantity += quantity
      existing.entries.push(row)
      return
    }

    groups.set(key, {
      key,
      stockItemId: row.stock_item_id,
      stockItemName: row.stock_item?.name ?? 'Item removido',
      stockItemCode: row.stock_item?.code ?? null,
      stockItemUnit: row.stock_item?.unit ?? 'un',
      stockItemIconKey: row.stock_item?.svg_icon_key ?? null,
      itemCondition: groupCondition,
      totalQuantity: quantity,
      entries: [row],
    })
  })

  return Array.from(groups.values())
    .sort((a, b) => {
      if (b.totalQuantity !== a.totalQuantity) return b.totalQuantity - a.totalQuantity
      return a.stockItemName.localeCompare(b.stockItemName, 'pt-BR')
    })
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }))
}

export function StockReturnsTab({ profileId, embedded = false }: StockReturnsTabProps) {
  const [requests, setRequests] = useState<ReturnRequestWithDetails[]>([])
  const [stockItems, setStockItems] = useState<StockItemRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [workSites, setWorkSites] = useState<WorkSiteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<ReturnRequestWithDetails | null>(null)
  const [form, setForm] = useState<ReturnFormState>(initialFormState)
  const [formErrors, setFormErrors] = useState<ReturnFormErrors>({})
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [dragActivePhoto, setDragActivePhoto] = useState(false)
  const [dragActiveDoc, setDragActiveDoc] = useState(false)
  const [uploadingItemPhotoId, setUploadingItemPhotoId] = useState<string | null>(null)
  const [showProcessModal, setShowProcessModal] = useState(false)
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null)
  const [processForm, setProcessForm] = useState<ProcessFormState>({
    approve_quantity: '0',
    hold_quantity: '0',
    approved_condition: 'used',
    hold_condition: 'used',
    quick_action: 'return',
    triage_notes: '',
  })
  const [processError, setProcessError] = useState<string | null>(null)

  const fetchBaseOptions = useCallback(async () => {
    const [stockItemsResult, peopleResult, workSitesResult] = await Promise.all([
      supabase
        .from('stock_items')
        .select('id, code, name, unit, svg_icon_key, is_active, current_quantity, minimum_quantity, description, category, ca_nr, created_by, created_at, updated_at')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('people')
        .select('id, full_name, employee_id, profile_id, role, job_title, sector, cpf, photo_url, document_attachments, is_active, created_at, updated_at')
        .eq('is_active', true)
        .order('full_name', { ascending: true }),
      supabase
        .from('work_sites')
        .select('id, name, description, location, is_active, created_by, created_at, updated_at')
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ])

    if (stockItemsResult.error) throw new Error(stockItemsResult.error.message)
    if (peopleResult.error) throw new Error(peopleResult.error.message)
    if (workSitesResult.error) throw new Error(workSitesResult.error.message)

    setStockItems((stockItemsResult.data as StockItemRow[]) ?? [])
    setPeople((peopleResult.data as PersonRow[]) ?? [])
    setWorkSites((workSitesResult.data as WorkSiteRow[]) ?? [])
  }, [])

  const fetchRequests = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('stock_return_requests')
      .select(`
        *,
        stock_item:stock_items(id, code, name, unit, svg_icon_key),
        source_person:people!stock_return_requests_source_person_id_fkey(id, full_name, employee_id),
        source_work_site:work_sites!stock_return_requests_source_work_site_id_fkey(id, name),
        created_by_profile:profiles!stock_return_requests_created_by_fkey(id, full_name),
        approved_by_profile:profiles!stock_return_requests_approved_by_fkey(id, full_name)
      `)
      .order('created_at', { ascending: false })

    if (fetchError) {
      throw new Error(fetchError.message)
    }

    const mapped = ((data ?? []) as ReturnRequestWithDetails[]).map((row) => ({
      ...row,
      photo_url: normalizeUrl(row.photo_url),
      item_photo_url: normalizeUrl(row.item_photo_url),
      document_url: normalizeUrl(row.document_url),
    }))

    setRequests(mapped)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([fetchBaseOptions(), fetchRequests()])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nao foi possivel carregar as devolucoes.')
    } finally {
      setLoading(false)
    }
  }, [fetchBaseOptions, fetchRequests])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedRequest) return
    const refreshedSelection = requests.find((row) => row.id === selectedRequest.id) ?? null
    setSelectedRequest(refreshedSelection)
  }, [requests, selectedRequest])

  const filteredRequests = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()
    return requests.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false
      }

      if (!normalizedSearch) return true

      const haystack = [
        row.stock_item?.name,
        row.stock_item?.code,
        row.source_details,
        row.notes,
        row.document_name,
        sourceLabel(row),
        conditionLabel(row.item_condition),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [requests, searchQuery, statusFilter])

  const pendingCount = requests.filter((row) => row.status === 'pending').length
  const heldCount = requests.filter((row) => row.status === 'held').length

  const pendingInventoryGroups = useMemo(
    () => buildInventoryGroups(filteredRequests, (row) => row.quantity - row.approved_quantity - row.held_quantity, (row) => row.item_condition),
    [filteredRequests],
  )

  const heldInventoryGroups = useMemo(
    () => buildInventoryGroups(filteredRequests, (row) => row.held_quantity, (row) => row.item_condition),
    [filteredRequests],
  )

  const approvedInventoryGroups = useMemo(
    () => buildInventoryGroups(filteredRequests, (row) => row.approved_quantity, (row) => resolvedApprovedCondition(row) ?? 'used'),
    [filteredRequests],
  )

  const collaboratorOptions = people
    .filter((person) => person.role === 'collaborator' || person.role === 'leader')
    .map((person) => ({
      value: person.id,
      label: person.employee_id ? `${person.full_name} (${person.employee_id})` : person.full_name,
    }))

  const workSiteOptions = workSites.map((workSite) => ({
    value: workSite.id,
    label: workSite.name,
  }))

  const resetForm = () => {
    setForm(initialFormState)
    setFormErrors({})
    setUploadingPhoto(false)
    setUploadingDocument(false)
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    resetForm()
  }

  const validateForm = (): boolean => {
    const nextErrors: ReturnFormErrors = {}

    if (form.items.length === 0) {
      nextErrors.items = 'Adicione pelo menos um item para a devolucao.'
    } else {
      const hasInvalidQuantity = form.items.some((item) => {
        const quantity = Number.parseInt(item.quantity, 10)
        return !Number.isFinite(quantity) || quantity <= 0
      })
      if (hasInvalidQuantity) {
        nextErrors.items = 'Todas as quantidades precisam ser maiores que zero.'
      }
    }

    if (form.source_type === 'collaborator' && !form.source_person_id) {
      nextErrors.source_person_id = 'Selecione o colaborador de origem.'
    }

    if (form.source_type === 'work_site' && !form.source_work_site_id) {
      nextErrors.source_work_site_id = 'Selecione a obra de origem.'
    }

    setFormErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profileId) return

    try {
      setUploadingPhoto(true)
      setFormErrors((prev) => ({ ...prev, form: undefined }))
      const url = await uploadImageToStorage({
        file,
        scope: 'stock-returns/photos',
        entityId: profileId,
        options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
      })
      setForm((prev) => ({ ...prev, photo_url: normalizeUrl(url) }))
    } catch (uploadError) {
      setFormErrors((prev) => ({
        ...prev,
        form: uploadError instanceof Error ? uploadError.message : 'Nao foi possivel enviar a foto.',
      }))
    } finally {
      setUploadingPhoto(false)
      event.target.value = ''
    }
  }

  const handleDocumentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profileId) return

    try {
      setUploadingDocument(true)
      setFormErrors((prev) => ({ ...prev, form: undefined }))
      const url = await uploadFileToStorage({
        file,
        scope: 'stock-returns/documents',
        entityId: profileId,
      })
      setForm((prev) => ({
        ...prev,
        document_url: normalizeUrl(url),
        document_name: file.name,
      }))
    } catch (uploadError) {
      setFormErrors((prev) => ({
        ...prev,
        form: uploadError instanceof Error ? uploadError.message : 'Nao foi possivel enviar o documento.',
      }))
    } finally {
      setUploadingDocument(false)
      event.target.value = ''
    }
  }

  const handleCreateRequest = async () => {
    if (!profileId) {
      setFormErrors({ form: 'Sessao expirada. Faça login novamente.' })
      return
    }

    if (!validateForm()) {
      return
    }

    const sharedPayload = {
      source_type: form.source_type,
      source_person_id: form.source_type === 'collaborator' ? form.source_person_id : null,
      source_work_site_id: form.source_type === 'work_site' ? form.source_work_site_id : null,
      source_details: form.source_details.trim() || null,
      notes: form.notes.trim() || null,
      photo_url: form.photo_url,
      document_url: form.document_url,
      document_name: form.document_name,
      created_by: profileId,
    }
    const payload: TablesInsert<'stock_return_requests'>[] = form.items.map((item) => ({
      stock_item_id: item.stock_item_id,
      quantity: Number.parseInt(item.quantity, 10),
      item_photo_url: item.item_photo_url,
      item_condition: item.item_condition,
      ...sharedPayload,
    }))

    setSubmitting(true)
    setFormErrors({})
    try {
      const { error: insertError } = await supabase
        .from('stock_return_requests')
        .insert(payload)

      if (insertError) {
        throw new Error(insertError.message)
      }

      closeCreateModal()
      await fetchRequests()
    } catch (submitError) {
      setFormErrors({
        form: submitError instanceof Error ? submitError.message : 'Nao foi possivel registrar a devolucao.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    {
      key: 'stock_item',
      header: 'Item',
      render: (_value: unknown, row: ReturnRowRecord) => (
        <div className="flex flex-col">
          <span className="font-medium text-white">{row.stock_item?.name ?? 'Item removido'}</span>
          <span className="font-mono text-xs text-orange-300">{row.stock_item?.code ?? '-'}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Quantidade',
      sortable: true,
      render: (_value: unknown, row: ReturnRowRecord) => (
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-orange-200">
            {formatQuantity(row.quantity, row.stock_item?.unit ?? 'un')}
          </span>
          <Badge variant={conditionVariant(row.item_condition as 'used' | 'damaged' | 'mixed')} size="sm">
            {conditionLabel(row.item_condition as 'used' | 'damaged' | 'mixed')}
          </Badge>
        </div>
      ),
    },
    {
      key: 'distribution',
      header: 'Triagem',
      render: (_value: unknown, row: ReturnRowRecord) => (
        <div className="flex flex-col text-xs">
          <span className="text-emerald-300">Volta: {row.approved_quantity}</span>
          <span className="text-sky-300">Mantido: {row.held_quantity}</span>
        </div>
      ),
    },
    {
      key: 'source_type',
      header: 'Veio de',
      render: (_value: unknown, row: ReturnRowRecord) => (
        <div className="flex flex-col">
          <span className="text-white">{sourceLabel(row as ReturnRequestWithDetails)}</span>
          <span className="text-xs text-gray-500">
            {(row.source_type as ReturnSourceType) === 'collaborator' ? 'Colaborador' : 'Obra'}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (_value: unknown, row: ReturnRowRecord) => (
        <Badge variant={statusVariant(row.status as ReturnStatus)} dot>
          {statusLabel(row.status as ReturnStatus)}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Entrada',
      sortable: true,
      render: (_value: unknown, row: ReturnRowRecord) => (
        <span className="text-gray-300">{formatDateTime(row.created_at)}</span>
      ),
    },
  ]

  const selectedItemIds = new Set(form.items.map((item) => item.stock_item_id))

  const selectedItemsSummary = form.items
    .map((item) => {
      const stockItem = stockItems.find((stock) => stock.id === item.stock_item_id)
      if (!stockItem) return null
      return {
        draft: item,
        stockItem,
      }
    })
    .filter((value): value is { draft: ReturnDraftItem; stockItem: StockItemRow } => Boolean(value))

  const handleAddDraftItem = (item: StockItemRow) => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { stock_item_id: item.id, quantity: '1', item_photo_url: null, item_condition: 'used' }],
    }))
    setFormErrors((prev) => ({ ...prev, items: undefined }))
  }

  const handleDraftQuantityChange = (stockItemId: string, quantity: string) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.stock_item_id === stockItemId
          ? { ...item, quantity }
          : item,
      ),
    }))
    setFormErrors((prev) => ({ ...prev, items: undefined }))
  }

  const handleDraftConditionChange = (stockItemId: string, itemCondition: 'used' | 'damaged') => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.stock_item_id === stockItemId
          ? { ...item, item_condition: itemCondition }
          : item,
      ),
    }))
  }

  const handleRemoveDraftItem = (stockItemId: string) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.stock_item_id !== stockItemId),
    }))
  }

  const handleDraftItemPhotoChange = async (stockItemId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profileId) return

    try {
      setUploadingItemPhotoId(stockItemId)
      setFormErrors((prev) => ({ ...prev, form: undefined }))
      const url = await uploadImageToStorage({
        file,
        scope: 'stock-returns/item-photos',
        entityId: `${profileId}-${stockItemId}`,
        options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
      })

      setForm((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.stock_item_id === stockItemId
            ? { ...item, item_photo_url: normalizeUrl(url) }
            : item,
        ),
      }))
    } catch (uploadError) {
      setFormErrors((prev) => ({
        ...prev,
        form: uploadError instanceof Error ? uploadError.message : 'Nao foi possivel enviar a foto individual do item.',
      }))
    } finally {
      setUploadingItemPhotoId(null)
      event.target.value = ''
    }
  }

  const openProcessModal = (request: ReturnRequestWithDetails) => {
    const remaining = Math.max(request.quantity - request.approved_quantity - request.held_quantity, 0)
    setSelectedRequest(request)
    setProcessForm({
      approve_quantity: String(remaining),
      hold_quantity: '0',
      approved_condition: request.approved_condition ?? (request.item_condition === 'damaged' ? 'damaged' : 'used'),
      hold_condition: request.item_condition,
      quick_action: 'return',
      triage_notes: request.triage_notes ?? '',
    })
    setProcessError(null)
    setShowProcessModal(true)
  }

  const handleProcessQuantityChange = (destination: 'return' | 'hold', value: string) => {
    if (!selectedRequest) return

    const remaining = Math.max(selectedRequest.quantity - selectedRequest.approved_quantity - selectedRequest.held_quantity, 0)
    const parsed = Number.parseInt(value, 10)
    const safePrimaryQuantity = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), remaining) : 0
    const nextApproveQuantity = destination === 'return' ? safePrimaryQuantity : 0
    const nextHoldQuantity = destination === 'hold' ? safePrimaryQuantity : 0

    setProcessForm((prev) => ({
      ...prev,
      approve_quantity: String(nextApproveQuantity),
      hold_quantity: String(nextHoldQuantity),
      quick_action: destination,
    }))
    setProcessError(null)
  }

  const handleProcessDestinationChoice = (destination: 'return' | 'hold') => {
    if (!selectedRequest) return

    const remaining = Math.max(selectedRequest.quantity - selectedRequest.approved_quantity - selectedRequest.held_quantity, 0)
    setProcessForm((prev) => ({
      ...prev,
      approve_quantity: destination === 'return' ? String(remaining) : '0',
      hold_quantity: destination === 'hold' ? String(remaining) : '0',
      quick_action: destination,
      hold_condition: destination === 'hold' ? selectedRequest.item_condition : prev.hold_condition,
    }))
    setProcessError(null)
  }

  const handleSingleUnitDecision = (
    mode: 'approve' | 'hold',
    condition?: 'new' | 'used' | 'damaged',
  ) => {
    setProcessForm((prev) => ({
      ...prev,
      approve_quantity: mode === 'approve' ? '1' : '0',
      hold_quantity: mode === 'hold' ? '1' : '0',
      approved_condition: mode === 'approve' && condition ? condition : prev.approved_condition,
      hold_condition: mode === 'hold' && (condition === 'used' || condition === 'damaged') ? condition : prev.hold_condition,
      quick_action: mode === 'approve' ? 'return' : 'hold',
    }))
    setProcessError(null)
  }

  const handleProcessRequest = async () => {
    if (!selectedRequest) return

    const approveQuantity = Number.parseInt(processForm.approve_quantity, 10)
    const holdQuantity = Number.parseInt(processForm.hold_quantity, 10)
    const remaining = selectedRequest.quantity - selectedRequest.approved_quantity - selectedRequest.held_quantity

    if (!Number.isFinite(approveQuantity) || approveQuantity < 0 || !Number.isFinite(holdQuantity) || holdQuantity < 0) {
      setProcessError('Informe quantidades validas para devolucao e triagem.')
      return
    }

    if (approveQuantity + holdQuantity <= 0) {
      setProcessError('Informe pelo menos uma quantidade para voltar ao estoque ou permanecer em triagem.')
      return
    }

    if (approveQuantity + holdQuantity > remaining) {
      setProcessError(`A soma nao pode passar da quantidade restante: ${remaining}.`)
      return
    }

    if (approveQuantity > 0 && !['new', 'used', 'damaged'].includes(processForm.approved_condition)) {
      setProcessError('Escolha como a quantidade aprovada volta para o estoque.')
      return
    }

    if (holdQuantity > 0 && !['used', 'damaged'].includes(processForm.hold_condition)) {
      setProcessError('Escolha se a quantidade em triagem fica como usada ou com avaria.')
      return
    }

    if (holdQuantity > 0 && !processForm.triage_notes.trim()) {
      setProcessError('Adicione uma observacao para o que vai continuar na triagem.')
      return
    }

    setUpdatingRequestId(selectedRequest.id)
    setProcessError(null)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('process_stock_return_request', {
        p_request_id: selectedRequest.id,
        p_approve_quantity: approveQuantity,
        p_hold_quantity: holdQuantity,
        p_triage_notes: processForm.triage_notes.trim() || null,
        p_approved_condition: approveQuantity > 0 ? processForm.approved_condition : null,
        p_hold_condition: holdQuantity > 0 ? processForm.hold_condition : null,
      })

      if (rpcError) {
        throw new Error(rpcError.message)
      }

      setShowProcessModal(false)
      await fetchRequests()
    } catch (processRpcError) {
      setProcessError(processRpcError instanceof Error ? processRpcError.message : 'Nao foi possivel processar a devolucao.')
    } finally {
      setUpdatingRequestId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {!embedded && (
        <div>
          <h2 className="text-2xl font-bold text-white">Itens devolvidos ao almoxarifado</h2>
          <p className="mt-1 text-sm text-gray-400">
            Registre devolucoes usadas, deixe em triagem e aprove apenas quando estiverem prontas para voltar ao estoque.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border border-orange-500/10 bg-orange-500/5" variant="bordered">
          <p className="text-xs uppercase tracking-[0.24em] text-orange-200/70">Pendentes</p>
          <p className="mt-2 text-3xl font-semibold text-white">{pendingCount}</p>
          <p className="mt-1 text-sm text-gray-400">Aguardando aprovacao para voltar ao uso.</p>
        </Card>
        <Card className="border border-sky-500/10 bg-sky-500/5" variant="bordered">
          <p className="text-xs uppercase tracking-[0.24em] text-sky-200/70">Mantidos</p>
          <p className="mt-2 text-3xl font-semibold text-white">{heldCount}</p>
          <p className="mt-1 text-sm text-gray-400">Itens separados para reavaliacao ou reparo.</p>
        </Card>
        <Card className="border border-emerald-500/10 bg-emerald-500/5" variant="bordered">
          <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/70">Fluxo</p>
          <p className="mt-2 text-lg font-semibold text-white">Triagem antes do estoque</p>
          <p className="mt-1 text-sm text-gray-400">Nada entra em `Qtd Atual` sem aprovacao.</p>
        </Card>
      </div>

      {error && (
        <Alert variant="danger" title="Erro na triagem">
          {error}
        </Alert>
      )}

      <div className="space-y-8">
        <InventoryStatusSection
          title="Estoque aguardando decisao"
          description="Itens ainda pendentes de processamento. Clique no item para abrir os registros individuais antes de decidir."
          badgeLabel="Pendentes"
          badgeValue={pendingInventoryGroups.length}
          tone="warning"
          quantityLabel="Aguardando decisao"
          groups={pendingInventoryGroups}
          expandedGroupKey={expandedGroupKey}
          onToggleGroup={setExpandedGroupKey}
          quantityForEntry={(entry) => entry.quantity - entry.approved_quantity - entry.held_quantity}
          conditionForEntry={(entry) => entry.item_condition}
        />

        <InventoryStatusSection
          title="Estoque mantido na triagem"
          description="Clique no item para abrir os registros individuais mantidos, com origem, foto e observacao de cada devolucao."
          badgeLabel="Itens em triagem"
          badgeValue={heldInventoryGroups.length}
          tone="info"
          quantityLabel="Mantido na triagem"
          groups={heldInventoryGroups}
          expandedGroupKey={expandedGroupKey}
          onToggleGroup={setExpandedGroupKey}
          quantityForEntry={(entry) => entry.held_quantity}
          conditionForEntry={(entry) => entry.item_condition}
        />

        <InventoryStatusSection
          title="Estoque aprovado para uso"
          description="Itens que ja voltaram para uso no almoxarifado, mas continuam com o historico individual preservado."
          badgeLabel="Aprovados"
          badgeValue={approvedInventoryGroups.length}
          tone="success"
          quantityLabel="Voltou ao estoque"
          groups={approvedInventoryGroups}
          expandedGroupKey={expandedGroupKey}
          onToggleGroup={setExpandedGroupKey}
          quantityForEntry={(entry) => entry.approved_quantity}
          conditionForEntry={(entry) => resolvedApprovedCondition(entry) ?? 'used'}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <Input
              label="Buscar devolucao"
              placeholder="Busque por item, codigo, origem ou observacao..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              options={STATUS_OPTIONS}
            />
          </div>
          <Button onClick={() => setShowCreateModal(true)}>
            Nova devolucao
          </Button>
        </div>

        <div className="mt-4">
          {filteredRequests.length === 0 ? (
            <EmptyState
              icon={<ClipboardIcon size={48} />}
              title="Nenhuma devolucao encontrada"
              description="Quando um item usado voltar ao almoxarifado, ele aparece aqui para triagem e aprovacao."
              action={{
                label: 'Registrar devolucao',
                onClick: () => setShowCreateModal(true),
              }}
            />
          ) : (
            <DataTable
              columns={columns}
              data={filteredRequests}
              keyExtractor={(row) => row.id}
              selectedId={selectedRequest?.id ?? null}
              onRowClick={(row) => setSelectedRequest(row)}
            />
          )}
        </div>
      </Card>

      {selectedRequest && (
        <Card variant="bordered" className="border-white/8 bg-[#111215]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold text-white">
                  {selectedRequest.stock_item?.name ?? 'Item devolvido'}
                </h3>
                <Badge variant={statusVariant(selectedRequest.status)} dot>
                  {statusLabel(selectedRequest.status)}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-gray-400">
                {selectedRequest.stock_item?.code ?? '-'} • {formatQuantity(selectedRequest.quantity, selectedRequest.stock_item?.unit ?? 'un')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedRequest.approved_quantity + selectedRequest.held_quantity < selectedRequest.quantity && (
                <Button
                  onClick={() => openProcessModal(selectedRequest)}
                  disabled={updatingRequestId === selectedRequest.id}
                >
                  Processar quantidades
                </Button>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DetailCard label="Origem" value={sourceLabel(selectedRequest)} />
            <DetailCard label="Tipo de origem" value={selectedRequest.source_type === 'collaborator' ? 'Colaborador' : 'Obra'} />
            <DetailCard label="Estado ao chegar" value={conditionLabel(selectedRequest.item_condition)} />
            <DetailCard label="Estado aprovado" value={selectedRequest.approved_condition ? stockConditionLabel(selectedRequest.approved_condition) : 'Ainda nao definido'} />
            <DetailCard label="Registrado em" value={formatDateTime(selectedRequest.created_at)} />
            <DetailCard label="Distribuicao" value={`Volta ${selectedRequest.approved_quantity} • Mantido ${selectedRequest.held_quantity} • Total ${selectedRequest.quantity}`} />
            <DetailCard
              label="Aprovado por"
              value={
                selectedRequest.approved_by_profile?.full_name
                  ? `${selectedRequest.approved_by_profile.full_name}${selectedRequest.approved_at ? ` em ${formatDateTime(selectedRequest.approved_at)}` : ''}`
                  : 'Ainda nao aprovado'
              }
            />
          </div>

          {(selectedRequest.source_details || selectedRequest.notes || selectedRequest.triage_notes) && (
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <TextBlock title="Detalhes de origem" text={selectedRequest.source_details} emptyText="Nenhum detalhe adicional informado." />
              <TextBlock title="Observacoes" text={selectedRequest.notes} emptyText="Nenhuma observacao registrada." />
              <TextBlock title="Observacao da triagem" text={selectedRequest.triage_notes} emptyText="Nenhuma observacao de triagem registrada." />
            </div>
          )}

          {(selectedRequest.photo_url || selectedRequest.item_photo_url || selectedRequest.document_url) && (
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <Card variant="bordered" className="border-white/8 bg-white/3">
                <p className="text-sm font-medium text-white">Foto geral</p>
                {selectedRequest.photo_url ? (
                  <a href={selectedRequest.photo_url} target="_blank" rel="noreferrer">
                    <img
                      src={selectedRequest.photo_url}
                      alt="Foto da devolucao"
                      className="mt-3 max-h-72 w-full rounded-xl border border-white/8 object-cover"
                    />
                  </a>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">Nenhuma foto anexada.</p>
                )}
              </Card>
              <Card variant="bordered" className="border-white/8 bg-white/3">
                <p className="text-sm font-medium text-white">Foto do item</p>
                {selectedRequest.item_photo_url ? (
                  <a href={selectedRequest.item_photo_url} target="_blank" rel="noreferrer">
                    <img
                      src={selectedRequest.item_photo_url}
                      alt="Foto individual do item"
                      className="mt-3 max-h-72 w-full rounded-xl border border-white/8 object-cover"
                    />
                  </a>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">Nenhuma foto individual anexada.</p>
                )}
              </Card>
              <Card variant="bordered" className="border-white/8 bg-white/3">
                <p className="text-sm font-medium text-white">Documento</p>
                {selectedRequest.document_url ? (
                  <div className="mt-3">
                    <p className="text-sm text-gray-300">{selectedRequest.document_name ?? 'Documento anexado'}</p>
                    <a
                      href={selectedRequest.document_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-sm font-medium text-orange-300 hover:text-orange-200"
                    >
                      Abrir documento
                    </a>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">Nenhum documento anexado.</p>
                )}
              </Card>
            </div>
          )}
        </Card>
      )}

      <Modal
        isOpen={showCreateModal}
        onClose={closeCreateModal}
        title="Registrar devolucao para triagem"
        size="xl"
      >
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
            <Card variant="bordered" className="border-white/8 bg-white/3">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Selecionar itens devolvidos</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Use a busca nativa do estoque e clique para adicionar varios itens de uma vez.
                  </p>
                </div>
                <div className="rounded-full border border-white/8 bg-black/20 px-3 py-1 text-xs text-gray-400">
                  {form.items.length} item(ns)
                </div>
              </div>

              <StockItemPicker
                items={stockItems}
                onSelect={handleAddDraftItem}
                disabledIds={selectedItemIds}
                emptyMessage="Nenhum item disponivel para devolucao."
              />
            </Card>

            <Card variant="bordered" className="border-white/8 bg-[#101115]">
              <div className="mb-3">
                <p className="text-sm font-medium text-white">Itens escolhidos</p>
                <p className="mt-1 text-xs text-gray-500">
                  Ajuste a quantidade de cada item antes de registrar a triagem.
                </p>
              </div>

              {formErrors.items && (
                <Alert variant="danger" className="mb-4">
                  {formErrors.items}
                </Alert>
              )}

              {selectedItemsSummary.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-8 text-center">
                  <PackageIcon size={36} className="mx-auto text-gray-600" />
                  <p className="mt-3 text-sm text-gray-400">
                    Nenhum item adicionado ainda.
                  </p>
                </div>
              ) : (
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {selectedItemsSummary.map(({ draft, stockItem }) => (
                    <div
                      key={stockItem.id}
                      className="rounded-2xl border border-white/8 bg-black/20 p-2.5"
                    >
                      <div className="flex gap-2.5">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-orange-400/12 bg-orange-500/10">
                          <ItemVisual iconKey={stockItem.svg_icon_key} size={24} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">{stockItem.name}</p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {stockItem.code ?? '-'} • {stockItem.category ?? 'Sem categoria'} • Disponivel {formatQuantity(stockItem.current_quantity, stockItem.unit)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveDraftItem(stockItem.id)}
                              className="rounded-xl border border-red-500/15 bg-red-500/8 px-2 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/14"
                            >
                              Remover
                            </button>
                          </div>

                          <div className="mt-3 rounded-2xl border border-white/8 bg-white/4 p-3">
                            <div className="grid gap-3">
                              <div className="grid grid-cols-[minmax(92px,120px)_minmax(0,1fr)] gap-3">
                                <Input
                                  label="Qtd"
                                  type="number"
                                  min="1"
                                  value={draft.quantity}
                                  onChange={(event) => handleDraftQuantityChange(stockItem.id, event.target.value)}
                                />

                                <div className="flex min-w-0 items-end">
                                  <Badge variant="default" size="sm" className="mb-1">
                                    {stockItem.unit}
                                  </Badge>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Estado do item</p>
                                <div className="grid gap-2">
                                  {([
                                    {
                                      value: 'used',
                                      label: 'Usado',
                                      icon: <UsedConditionIcon size={18} className="text-sky-200" />,
                                      activeClass: 'border-sky-400/45 bg-sky-500/12 text-sky-100',
                                      iconClass: 'border-sky-400/20 bg-sky-500/12',
                                    },
                                    {
                                      value: 'damaged',
                                      label: 'Com avaria',
                                      icon: <DamagedConditionIcon size={18} className="text-red-200" />,
                                      activeClass: 'border-red-400/45 bg-red-500/12 text-red-100',
                                      iconClass: 'border-red-400/20 bg-red-500/12',
                                    },
                                  ] as const).map((option) => {
                                    const isActive = draft.item_condition === option.value
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleDraftConditionChange(stockItem.id, option.value)}
                                        className={cn(
                                          'flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                                          isActive
                                            ? option.activeClass
                                            : 'border-white/8 bg-black/20 text-gray-300 hover:bg-white/6 hover:text-white',
                                        )}
                                      >
                                        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', option.iconClass)}>
                                          {option.icon}
                                        </span>
                                        <span className="min-w-0 flex-1 leading-5">{option.label}</span>
                                        <span
                                          className={cn(
                                            'h-2.5 w-2.5 shrink-0 rounded-full border',
                                            isActive ? 'border-current bg-current' : 'border-white/20',
                                          )}
                                        />
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>
                            <p className="mt-3 rounded-xl border border-white/8 bg-black/18 px-3 py-2 text-xs leading-5 text-gray-400">
                              {conditionDescription(draft.item_condition)}
                            </p>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <label className="cursor-pointer text-xs font-medium text-orange-300 hover:text-orange-200">
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={(event) => void handleDraftItemPhotoChange(stockItem.id, event)}
                                disabled={uploadingItemPhotoId === stockItem.id}
                              />
                              {uploadingItemPhotoId === stockItem.id
                                ? 'Enviando foto do item...'
                                : draft.item_photo_url
                                  ? 'Trocar foto do item'
                                  : 'Adicionar foto do item'}
                            </label>
                            {draft.item_photo_url ? (
                              <a
                                href={draft.item_photo_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-gray-400 hover:text-white"
                              >
                                Abrir foto
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Origem"
              value={form.source_type}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  source_type: event.target.value as ReturnSourceType,
                  source_person_id: '',
                  source_work_site_id: '',
                }))
              }
              options={[
                { value: 'collaborator', label: 'Colaborador' },
                { value: 'work_site', label: 'Obra' },
              ]}
            />

            {form.source_type === 'collaborator' ? (
              <Select
                label="Colaborador"
                value={form.source_person_id}
                onChange={(event) => setForm((prev) => ({ ...prev, source_person_id: event.target.value }))}
                options={collaboratorOptions}
                placeholder="Selecione o colaborador"
                error={formErrors.source_person_id}
              />
            ) : (
              <Select
                label="Obra"
                value={form.source_work_site_id}
                onChange={(event) => setForm((prev) => ({ ...prev, source_work_site_id: event.target.value }))}
                options={workSiteOptions}
                placeholder="Selecione a obra"
                error={formErrors.source_work_site_id}
              />
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TextArea
              label="Detalhes de como voltou"
              placeholder="Ex: voltou usado, precisa limpeza, veio desmontado, faltando acessorio..."
              value={form.source_details}
              onChange={(event) => setForm((prev) => ({ ...prev, source_details: event.target.value }))}
            />
            <TextArea
              label="Observacoes"
              placeholder="Informacoes extras para a aprovacao."
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card variant="bordered" className="border-white/8 bg-white/3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Foto</p>
                  <p className="mt-1 text-xs text-gray-500">
                    JPG, PNG ou WEBP. Serve para mostrar o estado em que o item voltou.
                  </p>
                </div>
              </div>

              {form.photo_url ? (
                <a href={form.photo_url} target="_blank" rel="noreferrer">
                  <img
                    src={form.photo_url}
                    alt="Preview da devolucao"
                    className="mt-4 max-h-56 w-full rounded-xl border border-white/8 object-cover"
                  />
                </a>
              ) : (
                <div
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragActivePhoto(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setDragActivePhoto(false)
                  }}
                  onDrop={async (event) => {
                    event.preventDefault()
                    setDragActivePhoto(false)
                    const file = event.dataTransfer.files?.[0]
                    if (file) {
                      const synthEvent = { target: { files: [file], value: '' } } as unknown as ChangeEvent<HTMLInputElement>
                      await handlePhotoChange(synthEvent)
                    }
                  }}
                  className={cn(
                    'mt-4 rounded-xl border-2 border-dashed p-4 transition-colors',
                    dragActivePhoto ? 'border-orange-500 bg-orange-500/10' : 'border-white/10 bg-black/20',
                  )}
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => void handlePhotoChange(event)}
                    disabled={uploadingPhoto}
                    className="block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
                  />
                  <p className="mt-3 text-xs text-gray-500">
                    Solte uma foto aqui ou clique acima. JPG, PNG ou WEBP, ate {DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB.
                  </p>
                  {uploadingPhoto ? <p className="mt-2 text-xs text-orange-300">Enviando imagem...</p> : null}
                </div>
              )}
            </Card>

            <Card variant="bordered" className="border-white/8 bg-white/3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Documento</p>
                  <p className="mt-1 text-xs text-gray-500">
                    PDF, DOC, DOCX ou imagem. Laudo, comprovante ou qualquer anexo de suporte.
                  </p>
                </div>
              </div>

              {form.document_url ? (
                <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-4">
                  <p className="text-sm text-white">{form.document_name ?? 'Documento anexado'}</p>
                  <a
                    href={form.document_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm font-medium text-orange-300 hover:text-orange-200"
                  >
                    Abrir documento
                  </a>
                </div>
              ) : (
                <div
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragActiveDoc(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setDragActiveDoc(false)
                  }}
                  onDrop={async (event) => {
                    event.preventDefault()
                    setDragActiveDoc(false)
                    const file = event.dataTransfer.files?.[0]
                    if (file) {
                      const synthEvent = { target: { files: [file], value: '' } } as unknown as ChangeEvent<HTMLInputElement>
                      await handleDocumentChange(synthEvent)
                    }
                  }}
                  className={cn(
                    'mt-4 rounded-xl border-2 border-dashed p-4 transition-colors',
                    dragActiveDoc ? 'border-orange-500 bg-orange-500/10' : 'border-white/10 bg-black/20',
                  )}
                >
                  <input
                    type="file"
                    accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp"
                    onChange={(event) => void handleDocumentChange(event)}
                    disabled={uploadingDocument}
                    className="block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
                  />
                  <p className="mt-3 text-xs text-gray-500">
                    Solte o documento aqui ou clique acima. PDF, DOC, DOCX ou imagem.
                  </p>
                  {uploadingDocument ? <p className="mt-2 text-xs text-orange-300">Enviando documento...</p> : null}
                </div>
              )}
            </Card>
          </div>

          {formErrors.form && (
            <Alert variant="danger">{formErrors.form}</Alert>
          )}

          <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
            <Button variant="secondary" onClick={closeCreateModal}>
              Cancelar
            </Button>
            <Button
              onClick={() => void handleCreateRequest()}
              isLoading={submitting}
              disabled={uploadingPhoto || uploadingDocument}
            >
              Registrar {form.items.length > 1 ? `${form.items.length} devolucoes` : 'na triagem'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showProcessModal && Boolean(selectedRequest)}
        onClose={() => setShowProcessModal(false)}
        title="Processar devolucao"
        size="md"
      >
        {selectedRequest ? (
          <div className="space-y-4">
            {(() => {
              const remaining = selectedRequest.quantity - selectedRequest.approved_quantity - selectedRequest.held_quantity
              const approveQuantity = Number.parseInt(processForm.approve_quantity, 10)
              const holdQuantity = Number.parseInt(processForm.hold_quantity, 10)
              const safeApproveQuantity = Number.isFinite(approveQuantity) ? Math.min(Math.max(approveQuantity, 0), remaining) : 0
              const safeHoldQuantity = Number.isFinite(holdQuantity) ? Math.min(Math.max(holdQuantity, 0), remaining) : 0
              const safePendingQuantity = Math.max(remaining - safeApproveQuantity - safeHoldQuantity, 0)
              const activeQuantityValue = processForm.quick_action === 'hold'
                ? String(safeHoldQuantity)
                : String(safeApproveQuantity)

              return (
                <>
                  <div className="rounded-3xl border border-white/8 bg-[linear-gradient(180deg,_rgba(18,18,22,0.98)_0%,_rgba(11,12,15,0.98)_100%)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{selectedRequest.stock_item?.name ?? 'Item devolvido'}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Restante para decidir: {formatQuantity(remaining, selectedRequest.stock_item?.unit ?? 'un')}
                        </p>
                      </div>
                      <Badge variant={conditionVariant(selectedRequest.item_condition)} size="sm">
                        Chegou como {conditionLabel(selectedRequest.item_condition)}
                      </Badge>
                    </div>
                  </div>

                  {remaining > 1 && (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => handleProcessDestinationChoice('return')}
                          className={cn(
                            'rounded-2xl border p-4 text-left transition-colors',
                            safeApproveQuantity === remaining
                              ? 'border-emerald-400/35 bg-emerald-500/10'
                              : 'border-white/8 bg-white/3 hover:bg-white/5',
                          )}
                        >
                          <p className="text-sm font-medium text-white">Voltar tudo ao estoque</p>
                          <p className="mt-1 text-xs text-gray-400">A quantidade inteira entra no estoque.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleProcessDestinationChoice('hold')}
                          className={cn(
                            'rounded-2xl border p-4 text-left transition-colors',
                            safeHoldQuantity === remaining
                              ? 'border-amber-400/35 bg-amber-500/10'
                              : 'border-white/8 bg-white/3 hover:bg-white/5',
                          )}
                        >
                          <p className="text-sm font-medium text-white">Manter tudo em triagem</p>
                          <p className="mt-1 text-xs text-gray-400">Nada volta ao estoque agora.</p>
                        </button>
                      </div>

                      <Input
                        label={
                          processForm.quick_action === 'hold'
                            ? 'Quantidade que vai para triagem'
                            : 'Quantidade que volta para o estoque'
                        }
                        type="number"
                        min="0"
                        max={remaining}
                        value={activeQuantityValue}
                        onChange={(event) => handleProcessQuantityChange(processForm.quick_action, event.target.value)}
                        helperText={
                          processForm.quick_action === 'hold'
                            ? `O restante (${safePendingQuantity}) continuara pendente.`
                            : `O restante (${safePendingQuantity}) continuara pendente.`
                        }
                      />
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-3">
                    <Card variant="bordered" className="border-emerald-500/15 bg-emerald-500/8">
                      <p className="text-xs uppercase tracking-[0.22em] text-emerald-200/70">Volta ao estoque</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{safeApproveQuantity}</p>
                    </Card>
                    <Card variant="bordered" className="border-sky-500/15 bg-sky-500/8">
                      <p className="text-xs uppercase tracking-[0.22em] text-sky-200/70">Permanece na triagem</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{safeHoldQuantity}</p>
                    </Card>
                    <Card variant="bordered" className="border-amber-500/15 bg-amber-500/8">
                      <p className="text-xs uppercase tracking-[0.22em] text-amber-200/70">Continua pendente</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{safePendingQuantity}</p>
                    </Card>
                  </div>

                  {remaining === 1 ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-white">Escolha o destino dessa unidade</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {([
                          {
                            value: 'new',
                            label: 'Voltar como novo',
                            description: 'Entra no estoque como item novo.',
                            icon: <NewConditionIcon size={18} className="text-emerald-200" />,
                            active: safeApproveQuantity === 1 && processForm.approved_condition === 'new',
                            classes: 'border-emerald-400/30 bg-emerald-500/10',
                          },
                          {
                            value: 'used',
                            label: 'Voltar como usado',
                            description: 'Entra no estoque como item usado.',
                            icon: <UsedConditionIcon size={18} className="text-sky-200" />,
                            active: safeApproveQuantity === 1 && processForm.approved_condition === 'used',
                            classes: 'border-sky-400/30 bg-sky-500/10',
                          },
                          {
                            value: 'damaged',
                            label: 'Voltar com avaria',
                            description: 'Entra no estoque separado como avaria.',
                            icon: <DamagedConditionIcon size={18} className="text-red-200" />,
                            active: safeApproveQuantity === 1 && processForm.approved_condition === 'damaged',
                            classes: 'border-red-400/30 bg-red-500/10',
                          },
                        ] as const).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => handleSingleUnitDecision('approve', option.value)}
                            className={cn(
                              'rounded-2xl border p-4 text-left transition-colors',
                              option.active ? option.classes : 'border-white/8 bg-white/3 hover:bg-white/5',
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                                {option.icon}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-white">{option.label}</p>
                                <p className="mt-1 text-xs text-gray-400">{option.description}</p>
                              </div>
                            </div>
                          </button>
                        ))}

                        {([
                          {
                            value: 'used',
                            label: 'Manter como usado',
                            description: 'Permanece em triagem como item usado.',
                            icon: <UsedConditionIcon size={18} className="text-sky-200" />,
                            classes: 'border-sky-400/30 bg-sky-500/10',
                          },
                          {
                            value: 'damaged',
                            label: 'Manter com avaria',
                            description: 'Permanece em triagem como item avariado.',
                            icon: <DamagedConditionIcon size={18} className="text-red-200" />,
                            classes: 'border-red-400/30 bg-red-500/10',
                          },
                        ] as const).map((option) => (
                          <button
                            key={`hold-${option.value}`}
                            type="button"
                            onClick={() => handleSingleUnitDecision('hold', option.value)}
                            className={cn(
                              'rounded-2xl border p-4 text-left transition-colors',
                              safeHoldQuantity === 1 && processForm.hold_condition === option.value
                                ? option.classes
                                : 'border-white/8 bg-white/3 hover:bg-white/5',
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                                {option.icon}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-white">{option.label}</p>
                                <p className="mt-1 text-xs text-gray-400">{option.description}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : safeApproveQuantity > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-white">Se a quantidade voltar para o estoque, em qual estado ela entra?</p>
                      <div className="grid gap-3 md:grid-cols-3">
                        {([
                          {
                            value: 'new',
                            label: 'Novo',
                            description: 'Para itens revisados e prontos como novos.',
                            icon: <NewConditionIcon size={18} className="text-emerald-200" />,
                            classes: 'border-emerald-400/30 bg-emerald-500/10',
                          },
                          {
                            value: 'used',
                            label: 'Usado',
                            description: 'Para itens liberados para uso normal.',
                            icon: <UsedConditionIcon size={18} className="text-sky-200" />,
                            classes: 'border-sky-400/30 bg-sky-500/10',
                          },
                          {
                            value: 'damaged',
                            label: 'Com avaria',
                            description: 'Para itens devolvidos ao estoque de avaria.',
                            icon: <DamagedConditionIcon size={18} className="text-red-200" />,
                            classes: 'border-red-400/30 bg-red-500/10',
                          },
                        ] as const).map((option) => {
                          const active = processForm.approved_condition === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setProcessForm((prev) => ({ ...prev, approved_condition: option.value }))}
                              disabled={safeApproveQuantity === 0}
                              className={cn(
                                'rounded-2xl border p-4 text-left transition-colors',
                                safeApproveQuantity === 0
                                  ? 'cursor-not-allowed border-white/8 bg-black/20 opacity-45'
                                  : active
                                    ? option.classes
                                    : 'border-white/8 bg-white/3 hover:bg-white/5',
                              )}
                            >
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                                {option.icon}
                              </div>
                              <p className="mt-3 text-sm font-medium text-white">{option.label}</p>
                              <p className="mt-1 text-xs text-gray-400">{option.description}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}

            {safeHoldQuantity > 0 && remaining > 1 && (
              <div className="space-y-3 rounded-3xl border border-amber-500/15 bg-amber-500/8 p-4">
                <div>
                  <p className="text-sm font-medium text-white">Como fica a quantidade em triagem?</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Triagem nao volta como novo. Escolha apenas usado ou com avaria.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    {
                      value: 'used',
                      label: 'Usado',
                      description: 'Aguardando limpeza, revisao ou nova avaliacao.',
                      icon: <UsedConditionIcon size={18} className="text-sky-200" />,
                      classes: 'border-sky-400/35 bg-sky-500/10',
                    },
                    {
                      value: 'damaged',
                      label: 'Com avaria',
                      description: 'Aguardando reparo, descarte ou decisao tecnica.',
                      icon: <DamagedConditionIcon size={18} className="text-red-200" />,
                      classes: 'border-red-400/35 bg-red-500/10',
                    },
                  ] as const).map((option) => {
                    const active = processForm.hold_condition === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setProcessForm((prev) => ({ ...prev, hold_condition: option.value }))}
                        className={cn(
                          'rounded-2xl border p-4 text-left transition-colors',
                          active ? option.classes : 'border-white/8 bg-black/20 hover:bg-white/6',
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                            {option.icon}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{option.label}</p>
                            <p className="mt-1 text-xs text-gray-400">{option.description}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {safeHoldQuantity > 0 && (
              <TextArea
                label="Observacao da triagem"
                placeholder="Explique por que essa quantidade vai continuar na triagem."
                value={processForm.triage_notes}
                onChange={(event) => setProcessForm((prev) => ({ ...prev, triage_notes: event.target.value }))}
              />
            )}

            {processError && (
              <Alert variant="danger">{processError}</Alert>
            )}

            <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
              <Button variant="secondary" onClick={() => setShowProcessModal(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void handleProcessRequest()} isLoading={updatingRequestId === selectedRequest.id}>
                Salvar decisao
              </Button>
            </div>
                </>
              )
            })()}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="bordered" className="border-white/8 bg-white/3">
      <p className="text-xs uppercase tracking-[0.22em] text-gray-500">{label}</p>
      <p className="mt-2 text-sm text-white">{value}</p>
    </Card>
  )
}

function InventoryStatusSection({
  title,
  description,
  badgeLabel,
  badgeValue,
  tone,
  quantityLabel,
  groups,
  expandedGroupKey,
  onToggleGroup,
  quantityForEntry,
  conditionForEntry,
}: {
  title: string
  description: string
  badgeLabel: string
  badgeValue: number
  tone: 'warning' | 'info' | 'success'
  quantityLabel: string
  groups: InventoryGroup[]
  expandedGroupKey: string | null
  onToggleGroup: React.Dispatch<React.SetStateAction<string | null>>
  quantityForEntry: (entry: ReturnRequestWithDetails) => number
  conditionForEntry: (entry: ReturnRequestWithDetails) => 'used' | 'damaged' | 'new'
}) {
  if (groups.length === 0) return null

  const toneStyles = {
    warning: {
      frame: 'border-amber-500/15 bg-amber-500/10',
      frameText: 'text-amber-200/70',
      iconBox: 'border-amber-400/12 bg-amber-500/10',
      open: 'border-amber-400/30 bg-amber-500/12 text-amber-100',
      quantityLabel: 'text-amber-200/70',
      shadow: 'shadow-[0_18px_40px_rgba(245,158,11,0.08)]',
      activeBorder: 'border-amber-400/30',
      sourcePill: 'border-amber-500/15 bg-amber-500/8 text-amber-100',
    },
    info: {
      frame: 'border-sky-500/15 bg-sky-500/10',
      frameText: 'text-sky-200/70',
      iconBox: 'border-sky-400/12 bg-sky-500/10',
      open: 'border-sky-400/30 bg-sky-500/12 text-sky-100',
      quantityLabel: 'text-sky-200/70',
      shadow: 'shadow-[0_18px_40px_rgba(14,165,233,0.08)]',
      activeBorder: 'border-sky-400/30',
      sourcePill: 'border-sky-500/15 bg-sky-500/8 text-sky-100',
    },
    success: {
      frame: 'border-emerald-500/15 bg-emerald-500/10',
      frameText: 'text-emerald-200/70',
      iconBox: 'border-emerald-400/12 bg-emerald-500/10',
      open: 'border-emerald-400/30 bg-emerald-500/12 text-emerald-100',
      quantityLabel: 'text-emerald-200/70',
      shadow: 'shadow-[0_18px_40px_rgba(16,185,129,0.08)]',
      activeBorder: 'border-emerald-400/30',
      sourcePill: 'border-emerald-500/15 bg-emerald-500/8 text-emerald-100',
    },
  }[tone]

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-gray-400">{description}</p>
        </div>
        <div className={cn('rounded-2xl border px-4 py-3 text-right', toneStyles.frame)}>
          <p className={cn('text-xs uppercase tracking-[0.22em]', toneStyles.frameText)}>{badgeLabel}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{badgeValue}</p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const groupKey = `${tone}-${group.key}`
          const isExpanded = expandedGroupKey === groupKey

          return (
            <Card
              key={groupKey}
              variant="bordered"
              className={cn(
                'self-start overflow-hidden border-white/8 bg-[linear-gradient(180deg,_rgba(18,18,22,0.98)_0%,_rgba(10,10,13,0.98)_100%)] transition-colors',
                isExpanded && `${toneStyles.activeBorder} ${toneStyles.shadow}`,
              )}
            >
              <button
                type="button"
                onClick={() => onToggleGroup((current) => current === groupKey ? null : groupKey)}
                className="w-full text-left"
              >
                <div className="flex items-start gap-4">
                  <div className={cn('flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border', toneStyles.iconBox)}>
                    <ItemVisual iconKey={group.stockItemIconKey} size={30} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-white">{group.stockItemName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-gray-500">
                            {group.stockItemCode ?? '-'} • {group.entries.length} registro(s)
                          </p>
                          <Badge variant={conditionVariant(group.itemCondition)} size="sm">
                            {conditionLabel(group.itemCondition)}
                          </Badge>
                        </div>
                      </div>
                      <span className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                        isExpanded ? toneStyles.open : 'border-white/8 bg-white/4 text-gray-300',
                      )}>
                        {isExpanded ? 'Fechar' : 'Abrir'}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className={cn('text-[11px] uppercase tracking-[0.22em]', toneStyles.quantityLabel)}>{quantityLabel}</p>
                        <p className="mt-1 text-2xl font-semibold text-white">
                          {formatQuantity(group.totalQuantity, group.stockItemUnit)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-right">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Ultima entrada</p>
                        <p className="mt-1 text-sm text-gray-200">{formatDateTime(group.entries[0].created_at)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
                  {group.entries.map((entry) => {
                    const entryQuantity = quantityForEntry(entry)
                    const entryCondition = conditionForEntry(entry)
                    return (
                      <div
                        key={entry.id}
                        className="rounded-2xl border border-white/8 bg-white/4 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs', toneStyles.sourcePill)}>
                                {entry.source_type === 'collaborator' ? <UserIcon size={12} /> : <BuildingIcon size={12} />}
                                <span>{sourceLabel(entry)}</span>
                              </div>
                              <Badge variant={conditionVariant(entryCondition)} size="sm">
                                {conditionLabel(entryCondition)}
                              </Badge>
                            </div>
                            <p className="mt-2 text-sm font-medium text-white">
                              {quantityLabel}: {formatQuantity(entryQuantity, entry.stock_item?.unit ?? 'un')}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">{formatDateTime(entry.created_at)}</p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {entry.item_photo_url ? (
                              <a
                                href={entry.item_photo_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-black/20 px-3 py-1 text-xs text-gray-200 hover:bg-white/8"
                              >
                                <CameraIcon size={12} />
                                Foto do item
                              </a>
                            ) : null}
                            {entry.photo_url ? (
                              <a
                                href={entry.photo_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-black/20 px-3 py-1 text-xs text-gray-200 hover:bg-white/8"
                              >
                                <ClipboardIcon size={12} />
                                Foto geral
                              </a>
                            ) : null}
                          </div>
                        </div>

                        {(entry.triage_notes || entry.notes || entry.source_details) && (
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <MiniInfo
                              label="Motivo da triagem"
                              text={entry.triage_notes ?? 'Sem motivo registrado.'}
                            />
                            <MiniInfo
                              label="Observacao geral"
                              text={entry.notes ?? 'Sem observacao geral.'}
                            />
                            <MiniInfo
                              label="Como voltou"
                              text={entry.source_details ?? 'Sem detalhe de retorno.'}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function TextBlock({ title, text, emptyText }: { title: string; text: string | null; emptyText: string }) {
  return (
    <Card variant="bordered" className="border-white/8 bg-white/3">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-3 whitespace-pre-wrap text-sm text-gray-300">{text?.trim() || emptyText}</p>
    </Card>
  )
}

function MiniInfo({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{label}</p>
      <p className="mt-2 whitespace-pre-wrap text-xs text-gray-300">{text}</p>
    </div>
  )
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-300">{label}</label>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
      />
    </div>
  )
}
