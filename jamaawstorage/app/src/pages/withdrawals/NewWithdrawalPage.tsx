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
  SignaturePad,
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
import { ItemSelector } from './ItemSelector'
import { KitSelector } from './KitSelector'

type PeopleRow = Tables<'people'>
type WorkSiteRow = Tables<'work_sites'>
type StockItemRow = Tables<'stock_items'>

type EncodedDestination = `work_site:${string}` | `collaborator:${string}`

interface WithdrawalItemEntry {
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

const DEFAULT_WORKSITE_NAME = 'obra jamaaw'

const STEPS = [
  { key: 'destination', label: 'Solicitante e Fluxo', icon: UserIcon },
  { key: 'items', label: 'Itens da Retirada', icon: PackageIcon },
  { key: 'signatures', label: 'Documentacao e Assinaturas', icon: SignatureIcon },
  { key: 'review', label: 'Revisao e Confirmacao', icon: ClipboardIcon },
] as const

function makeEntryKey(entry: Pick<WithdrawalItemEntry, 'stock_item_id' | 'destination_type' | 'collaborator_id' | 'work_site_id'>): string {
  return [
    entry.stock_item_id,
    entry.destination_type,
    entry.collaborator_id ?? 'none',
    entry.work_site_id ?? 'none',
  ].join(':')
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

  const [leaders, setLeaders] = useState<PeopleRow[]>([])
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
  const [supervisorSignature, setSupervisorSignature] = useState<string>('')
  const [requesterSignature, setRequesterSignature] = useState<string>('')
  const [witnessSignature, setWitnessSignature] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('people').select('*').eq('is_active', true).eq('role', 'leader').order('full_name'),
      supabase.from('people').select('*').eq('is_active', true).eq('role', 'collaborator').order('full_name'),
      supabase.from('work_sites').select('*').eq('is_active', true).order('name'),
    ]).then(([leadersRes, collaboratorsRes, workSitesRes]) => {
      if (cancelled) return

      if (leadersRes.data) setLeaders(leadersRes.data as PeopleRow[])
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

  const selectedEntryKeys = useMemo(
    () => new Set(items.map((item) => makeEntryKey(item))),
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
      const key = makeEntryKey(item)
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
    if (selectedEntryKeys.has(makeEntryKey(entry))) return

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

      if (!selectedEntryKeys.has(makeEntryKey(entry))) {
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

  const handleUpdateQuantity = (entryKey: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) =>
        makeEntryKey(item) === entryKey ? { ...item, quantity } : item,
      ),
    )
  }

  const handleUpdateDestination = (entryKey: string, encodedDestination: string) => {
    const nextDestination = decodeDestination(encodedDestination)

    setItems((prev) => {
      const current = prev.find((item) => makeEntryKey(item) === entryKey)
      if (!current) return prev

      const updatedEntry = {
        ...current,
        ...nextDestination,
      }

      const duplicateExists = prev.some((item) =>
        makeEntryKey(item) !== entryKey && makeEntryKey(item) === makeEntryKey(updatedEntry),
      )

      if (duplicateExists) {
        setStepErrors((existing) => ({
          ...existing,
          items: `Ja existe "${current.stock_item.name}" no destino escolhido. Ajuste a quantidade no item existente.`,
        }))
        return prev
      }

      return prev.map((item) =>
        makeEntryKey(item) === entryKey
          ? updatedEntry
          : item,
      )
    })
  }

  const handleRemoveItem = (entryKey: string) => {
    setItems((prev) => prev.filter((item) => makeEntryKey(item) !== entryKey))
  }

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setPhotoError(null)
      const result = await imageFileToDataUrl(file, DEFAULT_IMAGE_UPLOAD_OPTIONS)
      setPhotoPreview(result)
      setPhotoUrl(result)
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Nao foi possivel enviar a foto.')
    }
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
      if (!requestedBy) errors.requestedBy = 'Selecione o lider solicitante'
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
          p_supervisor_signature: supervisorSignature || null,
          p_requester_signature: requesterSignature || null,
          p_witness_signature: witnessSignature || null,
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

        createdIds.push(withdrawalId)
      }

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

  const leaderOptions = leaders.map((leader) => ({
    value: leader.id,
    label: `${leader.full_name}${leader.employee_id ? ` (${leader.employee_id})` : ''}`,
  }))

  const collaboratorOptions = collaborators.map((collaborator) => ({
    value: collaborator.id,
    label: `${collaborator.full_name}${collaborator.employee_id ? ` (${collaborator.employee_id})` : ''}`,
  }))

  const selectedLeader = leaders.find((leader) => leader.id === requestedBy)

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
              label="Lider Solicitante"
              placeholder="Selecione o lider"
              options={leaderOptions}
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
                  const entryKey = makeEntryKey(item)
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
              {items.length} item(ns) em {groups.length} retirada(s) de destino
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
            <>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                className="block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-600"
              />
              <p className="text-xs text-gray-500">
                JPG ou PNG, ate {DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB
              </p>
            </>
          )}
          {photoError && <p className="text-xs text-red-400">{photoError}</p>}
        </div>
      </Card>

      <Card variant="bordered" padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Assinaturas</h3>
          <Badge variant="default" size="sm">Opcional nesta etapa</Badge>
        </div>

        <div className="flex flex-col gap-6">
          <SignaturePad
            label="Assinatura do Supervisor"
            value={supervisorSignature}
            onChange={setSupervisorSignature}
            placeholder="Supervisor assina aqui (opcional)"
          />

          <SignaturePad
            label="Assinatura do Solicitante"
            value={requesterSignature}
            onChange={setRequesterSignature}
            placeholder="Lider solicitante assina aqui (opcional)"
          />

          <SignaturePad
            label="Assinatura da Testemunha"
            value={witnessSignature}
            onChange={setWitnessSignature}
            placeholder="Testemunha assina aqui (opcional)"
          />
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
            <p className="text-xs font-medium text-gray-400">Lider solicitante</p>
            <p className="text-sm text-white">{selectedLeader?.full_name ?? '-'}</p>
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
            Como existem destinos diferentes, o sistema vai registrar {groups.length} retiradas separadas em sequencia.
          </Alert>
        )}
      </Card>

      {groups.map((group) => (
        <Card
          key={`${group.destination_type}-${group.collaborator_id ?? group.work_site_id ?? 'none'}`}
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
                  <tr key={makeEntryKey(item)} className="border-b border-gray-800">
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

      {(notes || photoPreview || supervisorSignature || requesterSignature || witnessSignature) && (
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SignaturePreview label="Supervisor" value={supervisorSignature} />
            <SignaturePreview label="Solicitante" value={requesterSignature} />
            <SignaturePreview label="Testemunha" value={witnessSignature} />
          </div>
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
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      {value ? (
        <img src={value} alt={`Assinatura ${label}`} className="h-16 rounded border border-gray-700 bg-white" />
      ) : (
        <span className="text-xs text-gray-500">Nao enviada</span>
      )}
    </div>
  )
}
