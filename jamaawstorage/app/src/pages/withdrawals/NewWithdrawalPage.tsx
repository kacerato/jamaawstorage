import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Tables, WithdrawalDestinationType } from '../../types/database'
import type { WithdrawalFormItem, KitWithItems } from '../../types'
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

interface WithdrawalItemEntry extends WithdrawalFormItem {
  stock_item: StockItemRow
}

const DEFAULT_WORKSITE_NAME = 'obra jamaaw'

const STEPS = [
  { key: 'destination', label: 'Solicitante e Destino', icon: UserIcon },
  { key: 'items', label: 'Itens da Retirada', icon: PackageIcon },
  { key: 'signatures', label: 'Documentacao e Assinaturas', icon: SignatureIcon },
  { key: 'review', label: 'Revisao e Confirmacao', icon: ClipboardIcon },
] as const

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
  const [destinationType, setDestinationType] = useState<WithdrawalDestinationType>('collaborator')
  const [collaboratorId, setCollaboratorId] = useState<string>('')
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
    return () => { cancelled = true }
  }, [])

  const selectedIds = useMemo(
    () => new Set(items.map((i) => i.stock_item_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length],
  )

  const handleAddItem = (stockItem: StockItemRow) => {
    if (selectedIds.has(stockItem.id)) return
    const entry: WithdrawalItemEntry = {
      stock_item_id: stockItem.id,
      lot_id: null,
      quantity: 1,
      unit: stockItem.unit,
      stock_item: stockItem,
    }
    setItems((prev) => [...prev, entry])
    setShowItemSelector(false)
  }

  const handleAddKit = (kit: KitWithItems) => {
    const newItems: WithdrawalItemEntry[] = []
    for (const ki of kit.kit_items) {
      if (!selectedIds.has(ki.stock_item_id) && ki.stock_items) {
        newItems.push({
          stock_item_id: ki.stock_item_id,
          lot_id: null,
          quantity: ki.quantity,
          unit: ki.stock_items.unit,
          stock_item: ki.stock_items,
        })
      }
    }
    setItems((prev) => [...prev, ...newItems])
    setShowKitSelector(false)
  }

  const handleUpdateQuantity = (stockItemId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.stock_item_id === stockItemId ? { ...item, quantity } : item,
      ),
    )
  }

  const handleRemoveItem = (stockItemId: string) => {
    setItems((prev) => prev.filter((item) => item.stock_item_id !== stockItemId))
  }

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
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

    const selectedItemIds = items.map((item) => item.stock_item_id)
    const { data, error } = await supabase
      .from('stock_items')
      .select('id, current_quantity, is_active')
      .in('id', selectedItemIds)

    if (error) {
      throw new Error(error.message)
    }

    const stockMap = new Map(
      ((data ?? []) as Pick<StockItemRow, 'id' | 'current_quantity' | 'is_active'>[]).map((row) => [row.id, row])
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
      if (destinationType === 'collaborator' && !collaboratorId)
        errors.collaboratorId = 'Selecione o colaborador'
      if (destinationType === 'work_site' && !defaultWorkSiteId)
        errors.workSiteId = 'Nenhuma obra padrao esta disponivel.'
    }

    if (step === 1) {
      if (itemsSource.length === 0) errors.items = 'Adicione ao menos um item'
      const overStock = itemsSource.find((i) => i.quantity > i.stock_item.current_quantity)
      if (overStock) {
        errors.items = `Quantidade de "${overStock.stock_item.name}" excede o estoque disponivel (${overStock.stock_item.current_quantity} ${overStock.stock_item.unit})`
      }
      const zeroQty = itemsSource.find((i) => i.quantity <= 0)
      if (zeroQty && !errors.items) {
        errors.items = 'Todas as quantidades devem ser maiores que zero'
      }
    }

    if (step === 2) {
      if (!supervisorSignature) errors.supervisorSignature = 'Assinatura do supervisor e obrigatoria'
      if (!requesterSignature) errors.requesterSignature = 'Assinatura do solicitante e obrigatoria'
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
          `O estoque de "${overStock.stock_item.name}" mudou durante a retirada. Disponivel agora: ${overStock.stock_item.current_quantity} ${overStock.stock_item.unit}.`
        )
        setCurrentStep(1)
        setSubmitting(false)
        return
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Nao foi possivel validar o estoque atualizado.')
      setSubmitting(false)
      return
    }

    const { data: withdrawalId, error: withdrawalError } = await supabase.rpc('create_completed_withdrawal', {
      p_requested_by: requestedBy,
      p_destination_type: destinationType as WithdrawalDestinationType,
      p_collaborator_id: destinationType === 'collaborator' ? collaboratorId : null,
      p_work_site_id: destinationType === 'work_site' ? defaultWorkSiteId : null,
      p_authorized_by: profile.id,
      p_notes: notes || null,
      p_photo_url: photoUrl,
      p_supervisor_signature: supervisorSignature,
      p_requester_signature: requesterSignature,
      p_witness_signature: witnessSignature || null,
      p_items: items.map((item) => ({
        stock_item_id: item.stock_item_id,
        lot_id: item.lot_id,
        quantity: item.quantity,
        unit: item.unit,
      })),
    })

    if (withdrawalError || !withdrawalId) {
      setSubmitError(withdrawalError?.message ?? 'Erro ao criar retirada')
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    navigate(`/withdrawals/${withdrawalId}`)
  }

  const leaderOptions = leaders.map((l) => ({
    value: l.id,
    label: `${l.full_name}${l.employee_id ? ` (${l.employee_id})` : ''}`,
  }))

  const collaboratorOptions = collaborators.map((c) => ({
    value: c.id,
    label: `${c.full_name}${c.employee_id ? ` (${c.employee_id})` : ''}`,
  }))

  const selectedLeader = leaders.find((l) => l.id === requestedBy)
  const selectedCollaborator = collaborators.find((c) => c.id === collaboratorId)
  const selectedWorkSite = workSites.find((w) => w.id === defaultWorkSiteId)

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
                  'text-xs font-medium text-center max-w-[80px]',
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
        <h3 className="mb-4 text-lg font-semibold text-white">
          Dados do Solicitante e Destino
        </h3>

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
              onChange={(e) => {
                setRequestedBy(e.target.value)
                setStepErrors((prev) => {
                  const next = { ...prev }
                  delete next.requestedBy
                  return next
                })
              }}
              error={stepErrors.requestedBy}
            />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-300">
                Tipo de Destino
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDestinationType('collaborator')}
                  className={cn(
                    'flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors',
                    destinationType === 'collaborator'
                      ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                      : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600',
                  )}
                >
                  <UserIcon size={18} className="mb-1 inline-block mr-2" />
                  Para Colaborador (EPI)
                </button>
                <button
                  type="button"
                  onClick={() => setDestinationType('work_site')}
                  className={cn(
                    'flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors',
                    destinationType === 'work_site'
                      ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                      : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600',
                  )}
                >
                  <ClipboardIcon size={18} className="mb-1 inline-block mr-2" />
                  Para obra jamaaw
                </button>
              </div>
            </div>

            {destinationType === 'collaborator' && (
              <Select
                label="Colaborador"
                placeholder="Selecione o colaborador"
                options={collaboratorOptions}
                value={collaboratorId}
                onChange={(e) => {
                  setCollaboratorId(e.target.value)
                  setStepErrors((prev) => {
                    const next = { ...prev }
                    delete next.collaboratorId
                    return next
                  })
                }}
                error={stepErrors.collaboratorId}
              />
            )}

            {destinationType === 'work_site' && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-4">
                <p className="text-sm font-medium text-orange-300">obra jamaaw</p>
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
          <h3 className="text-lg font-semibold text-white">Itens da Retirada</h3>
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
              Nenhum item adicionado. Use os botoes acima para adicionar itens ou kits.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Item</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Categoria</th>
                  <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Estoque</th>
                  <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Qtd</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Unidade</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-300">Acao</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isOverStock = item.quantity > item.stock_item.current_quantity
                  const isLowStock = item.stock_item.minimum_quantity > 0 && item.stock_item.current_quantity <= item.stock_item.minimum_quantity
                  return (
                    <tr key={item.stock_item_id} className="border-b border-gray-800">
                      <td className="px-3 py-2 text-sm text-white">{item.stock_item.name}</td>
                      <td className="px-3 py-2 text-sm text-gray-400">{item.stock_item.category ?? '-'}</td>
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
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val) && val >= 0) {
                              handleUpdateQuantity(item.stock_item_id, val)
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
                          onClick={() => handleRemoveItem(item.stock_item_id)}
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
              Total: {items.length} {items.length === 1 ? 'item' : 'itens'}
            </span>
            <span className="text-sm font-medium text-white">
              {items.reduce((sum, i) => sum + i.quantity, 0)} unidades
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
        <ItemSelector onSelect={handleAddItem} selectedIds={selectedIds} />
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
        <h3 className="mb-4 text-lg font-semibold text-white">
          Documentacao e Assinaturas
        </h3>

        <div className="mb-6 flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">Observacoes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observacoes adicionais (opcional)"
            rows={3}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          />
        </div>

        <div className="mb-6 flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">
            <CameraIcon size={16} className="mr-1 inline-block" />
            Registro Fotografico
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
              <p className="text-xs text-gray-500">JPG ou PNG, ate {DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb} MB</p>
            </>
          )}
          {photoError && <p className="text-xs text-red-400">{photoError}</p>}
        </div>
      </Card>

      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Assinaturas Eletronicas</h3>

        <div className="flex flex-col gap-6">
          <div>
            <SignaturePad
              label="Assinatura do Supervisor (quem autoriza)"
              value={supervisorSignature}
              onChange={(val) => {
                setSupervisorSignature(val)
                setStepErrors((prev) => {
                  const next = { ...prev }
                  delete next.supervisorSignature
                  return next
                })
              }}
              required
              placeholder="Supervisor assina aqui"
            />
            {stepErrors.supervisorSignature && (
              <p className="mt-1 text-sm text-red-400">{stepErrors.supervisorSignature}</p>
            )}
          </div>

          <div>
            <SignaturePad
              label="Assinatura do Solicitante (lider que solicitou)"
              value={requesterSignature}
              onChange={(val) => {
                setRequesterSignature(val)
                setStepErrors((prev) => {
                  const next = { ...prev }
                  delete next.requesterSignature
                  return next
                })
              }}
              required
              placeholder="Lider solicitante assina aqui"
            />
            {stepErrors.requesterSignature && (
              <p className="mt-1 text-sm text-red-400">{stepErrors.requesterSignature}</p>
            )}
          </div>

          <div>
            <SignaturePad
              label="Assinatura da Testemunha (almoxarife)"
              value={witnessSignature}
              onChange={setWitnessSignature}
              placeholder="Testemunha assina aqui (opcional)"
            />
          </div>
        </div>
      </Card>
    </div>
  )

  const renderStep4 = () => (
    <div className="flex flex-col gap-6">
      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Resumo da Retirada</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-gray-400">Codigo Previsto</p>
            <p className="text-sm text-white">{generateWithdrawalCodePreview()}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Lider Solicitante</p>
            <p className="text-sm text-white">{selectedLeader?.full_name ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Tipo de Destino</p>
            <p className="text-sm text-white">
              {destinationType === 'collaborator' ? 'Colaborador (EPI/Inventario)' : 'obra jamaaw'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">Destino</p>
            <p className="text-sm text-white">
              {destinationType === 'collaborator'
                ? selectedCollaborator?.full_name ?? '-'
                : selectedWorkSite?.name ?? DEFAULT_WORKSITE_NAME}
            </p>
          </div>
        </div>
      </Card>

      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Itens</h3>
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
              {items.map((item) => (
                <tr key={item.stock_item_id} className="border-b border-gray-800">
                  <td className="px-3 py-2 text-sm text-white">{item.stock_item.name}</td>
                  <td className="px-3 py-2 text-center text-sm text-gray-300">{item.quantity}</td>
                  <td className="px-3 py-2 text-sm text-gray-300">{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3">
          <span className="text-sm text-gray-400">
            Total: {items.length} {items.length === 1 ? 'item' : 'itens'}
          </span>
          <span className="text-sm font-medium text-white">
            {items.reduce((sum, i) => sum + i.quantity, 0)} unidades
          </span>
        </div>
      </Card>

      {notes && (
        <Card variant="bordered" padding="lg">
          <h3 className="mb-2 text-lg font-semibold text-white">Observacoes</h3>
          <p className="text-sm text-gray-300">{notes}</p>
        </Card>
      )}

      {photoPreview && (
        <Card variant="bordered" padding="lg">
          <h3 className="mb-2 text-lg font-semibold text-white">Registro Fotografico</h3>
          <img
            src={photoPreview}
            alt="Registro fotografico"
            className="max-h-48 rounded-lg border border-gray-700"
          />
        </Card>
      )}

      <Card variant="bordered" padding="lg">
        <h3 className="mb-4 text-lg font-semibold text-white">Assinaturas</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium text-gray-400">Supervisor</p>
            {supervisorSignature ? (
              <img src={supervisorSignature} alt="Assinatura do supervisor" className="h-16 rounded border border-gray-700 bg-white" />
            ) : (
              <span className="text-xs text-red-400">Pendente</span>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium text-gray-400">Solicitante</p>
            {requesterSignature ? (
              <img src={requesterSignature} alt="Assinatura do solicitante" className="h-16 rounded border border-gray-700 bg-white" />
            ) : (
              <span className="text-xs text-red-400">Pendente</span>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium text-gray-400">Testemunha</p>
            {witnessSignature ? (
              <img src={witnessSignature} alt="Assinatura da testemunha" className="h-16 rounded border border-gray-700 bg-white" />
            ) : (
              <span className="text-xs text-gray-500">Opcional</span>
            )}
          </div>
        </div>
      </Card>

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
            Preencha os dados para registrar uma nova retirada de materiais
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
