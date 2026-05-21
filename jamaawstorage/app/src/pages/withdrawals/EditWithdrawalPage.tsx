import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { KitWithItems, WithdrawalWithDetails } from '../../types'
import type { Tables, WithdrawalDestinationType } from '../../types/database'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Select,
  Spinner,
} from '../../components/ui'
import {
  ClipboardIcon,
  KitIcon,
  PackageIcon,
  SignatureIcon,
  UserIcon,
} from '../../components/icons'
import { ItemSelector, KitSelector } from './index'

type PeopleRow = Tables<'people'>
type WorkSiteRow = Tables<'work_sites'>
type StockItemRow = Tables<'stock_items'>

interface EditableWithdrawalItem {
  entry_id: string
  stock_item_id: string
  quantity: number
  unit: string
  lot_id: string | null
  stock_item: StockItemRow
  destination_type: WithdrawalDestinationType
  collaborator_id: string | null
  work_site_id: string | null
}

function createEntryId(): string {
  return `withdrawal-edit-${crypto.randomUUID()}`
}

function makeEntryDuplicateKey(entry: Pick<EditableWithdrawalItem, 'stock_item_id' | 'destination_type' | 'collaborator_id' | 'work_site_id'>): string {
  return [
    entry.stock_item_id,
    entry.destination_type,
    entry.collaborator_id ?? 'none',
    entry.work_site_id ?? 'none',
  ].join(':')
}

function makeDestinationGroupKey(entry: Pick<EditableWithdrawalItem, 'destination_type' | 'collaborator_id' | 'work_site_id'>): string {
  return [
    entry.destination_type,
    entry.collaborator_id ?? 'none',
    entry.work_site_id ?? 'none',
  ].join(':')
}

function encodeDestination(destinationType: WithdrawalDestinationType, collaboratorId: string | null, workSiteId: string | null): string {
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

function selectedWorkSiteLabel(workSites: WorkSiteRow[], workSiteId: string): string {
  const selected = workSites.find((workSite) => workSite.id === workSiteId)
  return selected?.name ?? 'Obra'
}

export function EditWithdrawalPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [withdrawal, setWithdrawal] = useState<WithdrawalWithDetails | null>(null)
  const [requesters, setRequesters] = useState<PeopleRow[]>([])
  const [collaborators, setCollaborators] = useState<PeopleRow[]>([])
  const [workSites, setWorkSites] = useState<WorkSiteRow[]>([])

  const [requestedBy, setRequestedBy] = useState('')
  const [destinationType, setDestinationType] = useState<WithdrawalDestinationType>('collaborator')
  const [collaboratorId, setCollaboratorId] = useState('')
  const [workSiteId, setWorkSiteId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<EditableWithdrawalItem[]>([])

  const [showItemSelector, setShowItemSelector] = useState(false)
  const [showKitSelector, setShowKitSelector] = useState(false)

  useEffect(() => {
    if (!id) return

    let cancelled = false

    Promise.all([
      supabase
        .from('withdrawals')
        .select(
          '*, withdrawal_items(*, stock_items(*)), requested_by_person:people!withdrawals_requested_by_fkey(*), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*), approved_by_profile:profiles!withdrawals_authorized_by_fkey(*)',
        )
        .eq('id', id)
        .single<WithdrawalWithDetails>(),
      supabase.from('people').select('*').eq('is_active', true).in('role', ['leader', 'supervisor']).order('full_name'),
      supabase.from('people').select('*').eq('is_active', true).eq('role', 'collaborator').order('full_name'),
      supabase.from('work_sites').select('*').eq('is_active', true).order('name'),
    ]).then(([withdrawalRes, requestersRes, collaboratorsRes, workSitesRes]) => {
      if (cancelled) return

      if (withdrawalRes.error || !withdrawalRes.data) {
        setError(withdrawalRes.error?.message ?? 'Retirada nao encontrada.')
        setLoading(false)
        return
      }

      const currentWithdrawal = withdrawalRes.data
      const nextItems = (currentWithdrawal.withdrawal_items ?? [])
        .filter((item) => item.stock_items)
        .map((item) => ({
          entry_id: createEntryId(),
          stock_item_id: item.stock_item_id,
          quantity: item.quantity,
          unit: item.unit,
          lot_id: item.lot_id,
          stock_item: item.stock_items,
          destination_type: currentWithdrawal.destination_type,
          collaborator_id: currentWithdrawal.collaborator_id,
          work_site_id: currentWithdrawal.work_site_id,
        }))

      setWithdrawal(currentWithdrawal)
      setRequesters((requestersRes.data as PeopleRow[]) ?? [])
      setCollaborators((collaboratorsRes.data as PeopleRow[]) ?? [])
      setWorkSites((workSitesRes.data as WorkSiteRow[]) ?? [])

      setRequestedBy(currentWithdrawal.requested_by)
      setDestinationType(currentWithdrawal.destination_type)
      setCollaboratorId(currentWithdrawal.collaborator_id ?? '')
      setWorkSiteId(currentWithdrawal.work_site_id ?? '')
      setNotes(currentWithdrawal.notes ?? '')
      setItems(nextItems)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [id])

  const originalQuantities = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of withdrawal?.withdrawal_items ?? []) {
      map.set(item.stock_item_id, (map.get(item.stock_item_id) ?? 0) + item.quantity)
    }
    return map
  }, [withdrawal])

  const selectedIds = useMemo(
    () => new Set(items.map((item) => item.stock_item_id)),
    [items],
  )

  const destinationOptions = useMemo(
    () => [
      ...collaborators.map((collaborator) => ({
        value: encodeDestination('collaborator', collaborator.id, null),
        label: `${collaborator.full_name}${collaborator.employee_id ? ` (${collaborator.employee_id})` : ''}`,
      })),
      ...workSites.map((workSite) => ({
        value: encodeDestination('work_site', null, workSite.id),
        label: workSite.name,
      })),
    ],
    [collaborators, workSites],
  )

  const requesterOptions = useMemo(
    () => requesters.map((requester) => ({
      value: requester.id,
      label: `${requester.full_name}${requester.employee_id ? ` (${requester.employee_id})` : ''}`,
    })),
    [requesters],
  )

  const collaboratorOptions = useMemo(
    () => collaborators.map((collaborator) => ({
      value: collaborator.id,
      label: `${collaborator.full_name}${collaborator.employee_id ? ` (${collaborator.employee_id})` : ''}`,
    })),
    [collaborators],
  )

  const workSiteOptions = useMemo(
    () => workSites.map((workSite) => ({
      value: workSite.id,
      label: workSite.name,
    })),
    [workSites],
  )

  const totalUnits = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  )

  const groups = useMemo(() => {
    const map = new Map<string, EditableWithdrawalItem[]>()

    for (const item of items) {
      const key = makeDestinationGroupKey(item)
      map.set(key, [...(map.get(key) ?? []), item])
    }

    return Array.from(map.entries()).map(([key, groupItems]) => ({
      key,
      destination_type: groupItems[0].destination_type,
      collaborator_id: groupItems[0].collaborator_id,
      work_site_id: groupItems[0].work_site_id,
      items: groupItems,
    }))
  }, [items])

  const canEdit = withdrawal && withdrawal.status !== 'rejected'

  const computeMaxAvailable = (item: EditableWithdrawalItem): number => {
    return item.stock_item.current_quantity + (originalQuantities.get(item.stock_item_id) ?? 0)
  }

  const refreshStockSnapshot = async () => {
    if (items.length === 0) return items

    const { data, error: stockError } = await supabase
      .from('stock_items')
      .select('*')
      .in('id', items.map((item) => item.stock_item_id))

    if (stockError) {
      throw new Error(stockError.message)
    }

    const stockMap = new Map(((data as StockItemRow[]) ?? []).map((item) => [item.id, item]))
    const nextItems = items.map((item) => ({
      ...item,
      stock_item: stockMap.get(item.stock_item_id) ?? item.stock_item,
    }))

    setItems(nextItems)
    return nextItems
  }

  const validateForm = (itemsSource: EditableWithdrawalItem[]): boolean => {
    if (!requestedBy) {
      setSaveError('Selecione quem solicitou a retirada.')
      return false
    }

    if (destinationType === 'collaborator' && !collaboratorId) {
      setSaveError('Selecione o colaborador da retirada.')
      return false
    }

    if (destinationType === 'work_site' && !workSiteId) {
      setSaveError('Selecione a obra da retirada.')
      return false
    }

    if (itemsSource.length === 0) {
      setSaveError('Adicione ao menos um item antes de salvar.')
      return false
    }

    const invalidItem = itemsSource.find((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)
    if (invalidItem) {
      setSaveError(`A quantidade de "${invalidItem.stock_item.name}" precisa ser maior que zero.`)
      return false
    }

    const overStock = itemsSource.find((item) => {
      const requestedForStockItem = itemsSource
        .filter((currentItem) => currentItem.stock_item_id === item.stock_item_id)
        .reduce((sum, currentItem) => sum + currentItem.quantity, 0)
      return requestedForStockItem > computeMaxAvailable(item)
    })

    if (overStock) {
      setSaveError(
        `"${overStock.stock_item.name}" excede o saldo disponivel para edicao. Maximo agora: ${computeMaxAvailable(overStock)} ${overStock.unit}.`,
      )
      return false
    }

    const invalidDestination = itemsSource.find((item) =>
      item.destination_type === 'collaborator' ? !item.collaborator_id : !item.work_site_id,
    )
    if (invalidDestination) {
      setSaveError(`Revise o destino de "${invalidDestination.stock_item.name}".`)
      return false
    }

    setSaveError(null)
    return true
  }

  const handleAddItem = (stockItem: StockItemRow) => {
    const newItem: EditableWithdrawalItem = {
      entry_id: createEntryId(),
      stock_item_id: stockItem.id,
      quantity: 1,
      unit: stockItem.unit,
      lot_id: null,
      stock_item: stockItem,
      destination_type: destinationType,
      collaborator_id: destinationType === 'collaborator' ? collaboratorId || null : null,
      work_site_id: destinationType === 'work_site' ? workSiteId || null : null,
    }

    if (items.some((item) => makeEntryDuplicateKey(item) === makeEntryDuplicateKey(newItem))) {
      setSaveError(`"${stockItem.name}" ja existe neste destino. Ajuste a quantidade ou divida o item existente.`)
      return
    }

    setItems((current) => [...current, newItem])
    setShowItemSelector(false)
    setSaveError(null)
  }

  const handleAddKit = (kit: KitWithItems) => {
    setItems((current) => {
      const nextItems = [...current]

      for (const kitItem of kit.kit_items) {
        if (!kitItem.stock_items) continue

        const kitEntryDestination = {
          stock_item_id: kitItem.stock_item_id,
          destination_type: destinationType,
          collaborator_id: destinationType === 'collaborator' ? collaboratorId || null : null,
          work_site_id: destinationType === 'work_site' ? workSiteId || null : null,
        }
        const existingIndex = nextItems.findIndex((item) => makeEntryDuplicateKey(item) === makeEntryDuplicateKey(kitEntryDestination))
        if (existingIndex >= 0) {
          nextItems[existingIndex] = {
            ...nextItems[existingIndex],
            quantity: nextItems[existingIndex].quantity + kitItem.quantity,
          }
          continue
        }

        nextItems.push({
          entry_id: createEntryId(),
          stock_item_id: kitItem.stock_item_id,
          quantity: kitItem.quantity,
          unit: kitItem.stock_items.unit,
          lot_id: null,
          stock_item: kitItem.stock_items,
          destination_type: destinationType,
          collaborator_id: destinationType === 'collaborator' ? collaboratorId || null : null,
          work_site_id: destinationType === 'work_site' ? workSiteId || null : null,
        })
      }

      return nextItems
    })

    setShowKitSelector(false)
    setSaveError(null)
  }

  const handleUpdateDestination = (entryId: string, encodedDestination: string) => {
    const nextDestination = decodeDestination(encodedDestination)

    setItems((current) => {
      const targetItem = current.find((item) => item.entry_id === entryId)
      if (!targetItem) return current

      const updatedItem = {
        ...targetItem,
        ...nextDestination,
      }

      const duplicateExists = current.some((item) =>
        item.entry_id !== entryId && makeEntryDuplicateKey(item) === makeEntryDuplicateKey(updatedItem),
      )

      if (duplicateExists) {
        setSaveError(`"${targetItem.stock_item.name}" ja existe no destino escolhido. Ajuste a quantidade no item existente.`)
        return current
      }

      setSaveError(null)
      return current.map((item) => item.entry_id === entryId ? updatedItem : item)
    })
  }

  const handleSplitItem = (entryId: string) => {
    setItems((current) => {
      const targetItem = current.find((item) => item.entry_id === entryId)
      if (!targetItem || targetItem.quantity <= 1) return current

      return current.flatMap((item) => {
        if (item.entry_id !== entryId) return [item]

        return [
          { ...item, quantity: item.quantity - 1 },
          { ...item, entry_id: createEntryId(), quantity: 1 },
        ]
      })
    })
    setSaveError(null)
  }

  const handleSave = async () => {
    if (!withdrawal || !id) return

    setSaving(true)
    try {
      const refreshedItems = await refreshStockSnapshot()
      if (!validateForm(refreshedItems)) {
        setSaving(false)
        return
      }

      const { data, error: updateError } = await (supabase as typeof supabase & {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string | null; error: { message: string } | null }>
      }).rpc('update_completed_withdrawal', {
        p_withdrawal_id: id,
        p_requested_by: requestedBy,
        p_destination_type: groups[0].destination_type,
        p_collaborator_id: groups[0].destination_type === 'collaborator' ? groups[0].collaborator_id : null,
        p_work_site_id: groups[0].destination_type === 'work_site' ? groups[0].work_site_id : null,
        p_notes: notes.trim() || null,
        p_items: refreshedItems.map((item) => ({
          stock_item_id: item.stock_item_id,
          lot_id: item.lot_id,
          quantity: item.quantity,
          unit: item.unit,
        })),
        p_groups: groups.map((group) => ({
          destination_type: group.destination_type,
          collaborator_id: group.destination_type === 'collaborator' ? group.collaborator_id : null,
          work_site_id: group.destination_type === 'work_site' ? group.work_site_id : null,
          items: group.items.map((item) => ({
            stock_item_id: item.stock_item_id,
            lot_id: item.lot_id,
            quantity: item.quantity,
            unit: item.unit,
          })),
        })),
      })

      if (updateError || !data) {
        setSaveError(updateError?.message ?? 'Nao foi possivel salvar a retirada.')
        setSaving(false)
        return
      }

      navigate(`/withdrawals/${id}?updated=1&printTerm=1`)
    } catch (caughtError) {
      setSaveError(caughtError instanceof Error ? caughtError.message : 'Nao foi possivel salvar a retirada.')
      setSaving(false)
      return
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !withdrawal) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" onClick={() => navigate('/withdrawals')}>
          Voltar para Retiradas
        </Button>
        <EmptyState
          icon={<ClipboardIcon size={48} />}
          title="Retirada nao encontrada"
          description={error ?? 'Nao foi possivel carregar a retirada.'}
        />
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" onClick={() => navigate(`/withdrawals/${withdrawal.id}`)}>
          Voltar para Detalhes
        </Button>
        <Alert variant="warning" title="Edicao indisponivel">
          Retiradas rejeitadas nao podem ser alteradas.
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white">Editar Retirada</h2>
            <Badge variant="warning" dot>
              {withdrawal.code}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Ajuste itens, destino e observacoes. Toda alteracao continuara registrada na auditoria.
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate(`/withdrawals/${withdrawal.id}`)}>
          Cancelar
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card variant="bordered" padding="lg">
            <div className="mb-4 flex items-center gap-2">
              <UserIcon size={18} className="text-orange-300" />
              <h3 className="text-lg font-semibold text-white">Solicitacao e Destino</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Solicitante"
                value={requestedBy}
                onChange={(event) => setRequestedBy(event.target.value)}
                options={requesterOptions}
                placeholder="Selecione quem solicitou"
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-300">Destino</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDestinationType('collaborator')}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                      destinationType === 'collaborator'
                        ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                        : 'border-white/8 bg-white/4 text-gray-400 hover:bg-white/6'
                    }`}
                  >
                    Colaborador
                  </button>
                  <button
                    type="button"
                    onClick={() => setDestinationType('work_site')}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                      destinationType === 'work_site'
                        ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                        : 'border-white/8 bg-white/4 text-gray-400 hover:bg-white/6'
                    }`}
                  >
                    Obra
                  </button>
                </div>
              </div>

              {destinationType === 'collaborator' ? (
                <Select
                  label="Colaborador"
                  value={collaboratorId}
                  onChange={(event) => setCollaboratorId(event.target.value)}
                  options={collaboratorOptions}
                  placeholder="Selecione o colaborador"
                />
              ) : (
                <Select
                  label="Obra"
                  value={workSiteId}
                  onChange={(event) => setWorkSiteId(event.target.value)}
                  options={workSiteOptions}
                  placeholder="Selecione a obra"
                />
              )}

              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-300">Observacoes</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  className="mt-1.5 w-full rounded-xl border border-white/8 bg-[#0d0d10] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
                  placeholder="Observacoes opcionais para a retirada"
                />
              </div>
            </div>
            <Alert variant="info" className="mt-4">
              Este destino serve como padrao para novos itens. O destino real pode ser ajustado individualmente na tabela abaixo.
            </Alert>
          </Card>

          <Card variant="bordered" padding="lg">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <PackageIcon size={18} className="text-orange-300" />
                  <h3 className="text-lg font-semibold text-white">Itens da Retirada</h3>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  O saldo considera esta propria retirada, entao voce pode corrigir quantidades sem perder o item atual.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<PackageIcon size={16} />}
                  onClick={() => setShowItemSelector(true)}
                >
                  Adicionar item
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<KitIcon size={16} />}
                  onClick={() => setShowKitSelector(true)}
                >
                  Usar kit
                </Button>
              </div>
            </div>

            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/4 px-4 py-10 text-center text-sm text-gray-500">
                Nenhum item mantido na retirada. Adicione pelo menos um item para salvar.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Item</th>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Destino</th>
                      <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Saldo livre</th>
                      <th className="px-3 py-2 text-center text-sm font-medium text-gray-300">Qtd</th>
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-300">Unidade</th>
                      <th className="px-3 py-2 text-right text-sm font-medium text-gray-300">Acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const maxAvailable = computeMaxAvailable(item)
                      const overStock = item.quantity > maxAvailable

                      return (
                        <tr key={item.entry_id} className="border-b border-gray-800">
                          <td className="px-3 py-3 text-sm text-white">
                            <div className="flex flex-col">
                              <span>{item.stock_item.name}</span>
                              <span className="text-xs text-gray-500">{item.stock_item.category ?? 'Sem categoria'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">
                            <select
                              value={encodeDestination(item.destination_type, item.collaborator_id, item.work_site_id)}
                              onChange={(event) => handleUpdateDestination(item.entry_id, event.target.value)}
                              className="w-full min-w-[220px] rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
                            >
                              {destinationOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className={`px-3 py-3 text-center text-sm ${overStock ? 'text-red-400' : 'text-gray-300'}`}>
                            {maxAvailable}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(event) => {
                                const nextQuantity = Number(event.target.value)
                                setItems((current) =>
                                  current.map((currentItem) =>
                                    currentItem.entry_id === item.entry_id
                                      ? { ...currentItem, quantity: Number.isFinite(nextQuantity) ? nextQuantity : 0 }
                                      : currentItem,
                                  ),
                                )
                              }}
                              className={`w-24 rounded-lg border bg-gray-950 px-3 py-2 text-center text-sm text-white outline-none transition-colors ${
                                overStock
                                  ? 'border-red-500 focus:ring-red-500/40'
                                  : 'border-gray-700 focus:border-orange-500 focus:ring-orange-500/30'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">{item.unit}</td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={item.quantity <= 1}
                                onClick={() => handleSplitItem(item.entry_id)}
                              >
                                Dividir
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setItems((current) => current.filter((currentItem) => currentItem.entry_id !== item.entry_id))
                                }}
                              >
                                Remover
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card variant="bordered" padding="lg">
            <div className="mb-4 flex items-center gap-2">
              <SignatureIcon size={18} className="text-orange-300" />
              <h3 className="text-lg font-semibold text-white">Assinaturas e Comprovantes</h3>
            </div>
            <p className="text-sm text-gray-400">
              A edicao preserva as assinaturas, foto e anexos ja existentes. Esta tela altera somente o conteudo operacional da retirada.
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/8 bg-[#111217] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Itens</p>
              <p className="mt-2 text-2xl font-semibold text-white">{items.length}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-[#111217] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Unidades</p>
              <p className="mt-2 text-2xl font-semibold text-orange-300">{totalUnits}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-[#111217] p-4 text-sm text-gray-300">
            <p className="font-medium text-white">Destinos da retirada</p>
            <div className="mt-3 space-y-2">
              {groups.map((group) => (
                <div key={group.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                  <span className="truncate">
                    {group.destination_type === 'collaborator'
                      ? collaborators.find((collaborator) => collaborator.id === group.collaborator_id)?.full_name ?? 'Colaborador'
                      : selectedWorkSiteLabel(workSites, group.work_site_id ?? '')}
                  </span>
                  <Badge variant={group.destination_type === 'work_site' ? 'info' : 'primary'} size="sm">
                    {group.items.length} item(ns)
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {saveError ? (
            <Alert variant="danger" title="Nao foi possivel salvar">
              {saveError}
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 rounded-2xl border border-emerald-400/10 bg-emerald-500/5 p-4">
            <p className="text-sm font-medium text-white">Ao salvar</p>
            <p className="text-sm text-gray-300">
              O estoque e o inventario vinculado serao recalculados na mesma transacao. Se houver mais de um destino, o sistema mantem esta retirada e cria os registros separados necessarios.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Button variant="secondary" onClick={() => navigate(`/withdrawals/${withdrawal.id}`)}>
              Voltar sem salvar
            </Button>
            <Button onClick={() => void handleSave()} isLoading={saving}>
              Salvar alteracoes
            </Button>
          </div>
        </div>
      </div>

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
        title="Adicionar Kit"
        size="lg"
      >
        <KitSelector onSelect={handleAddKit} />
      </Modal>
    </div>
  )
}
