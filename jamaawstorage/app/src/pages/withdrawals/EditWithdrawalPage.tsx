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
}

function createEntryId(): string {
  return `withdrawal-edit-${crypto.randomUUID()}`
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
      map.set(item.stock_item_id, item.quantity)
    }
    return map
  }, [withdrawal])

  const selectedIds = useMemo(
    () => new Set(items.map((item) => item.stock_item_id)),
    [items],
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

    const overStock = itemsSource.find((item) => item.quantity > computeMaxAvailable(item))
    if (overStock) {
      setSaveError(
        `"${overStock.stock_item.name}" excede o saldo disponivel para edicao. Maximo agora: ${computeMaxAvailable(overStock)} ${overStock.unit}.`,
      )
      return false
    }

    setSaveError(null)
    return true
  }

  const handleAddItem = (stockItem: StockItemRow) => {
    if (selectedIds.has(stockItem.id)) {
      setSaveError(`"${stockItem.name}" ja faz parte desta retirada. Ajuste a quantidade no item existente.`)
      return
    }

    setItems((current) => [
      ...current,
      {
        entry_id: createEntryId(),
        stock_item_id: stockItem.id,
        quantity: 1,
        unit: stockItem.unit,
        lot_id: null,
        stock_item: stockItem,
      },
    ])
    setShowItemSelector(false)
    setSaveError(null)
  }

  const handleAddKit = (kit: KitWithItems) => {
    setItems((current) => {
      const nextItems = [...current]

      for (const kitItem of kit.kit_items) {
        if (!kitItem.stock_items) continue

        const existingIndex = nextItems.findIndex((item) => item.stock_item_id === kitItem.stock_item_id)
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
        })
      }

      return nextItems
    })

    setShowKitSelector(false)
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
        p_destination_type: destinationType,
        p_collaborator_id: destinationType === 'collaborator' ? collaboratorId : null,
        p_work_site_id: destinationType === 'work_site' ? workSiteId : null,
        p_notes: notes.trim() || null,
        p_items: refreshedItems.map((item) => ({
          stock_item_id: item.stock_item_id,
          lot_id: item.lot_id,
          quantity: item.quantity,
          unit: item.unit,
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
            <p className="font-medium text-white">Resumo do destino</p>
            <p className="mt-3">
              {destinationType === 'collaborator'
                ? collaborators.find((collaborator) => collaborator.id === collaboratorId)?.full_name ?? 'Colaborador nao selecionado'
                : selectedWorkSiteLabel(workSites, workSiteId)}
            </p>
          </div>

          {saveError ? (
            <Alert variant="danger" title="Nao foi possivel salvar">
              {saveError}
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 rounded-2xl border border-emerald-400/10 bg-emerald-500/5 p-4">
            <p className="text-sm font-medium text-white">Ao salvar</p>
            <p className="text-sm text-gray-300">
              O estoque e o inventario vinculado serao recalculados na mesma transacao, e a alteracao continuara aparecendo na auditoria.
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
