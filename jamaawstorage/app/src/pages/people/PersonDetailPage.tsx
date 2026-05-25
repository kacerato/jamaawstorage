import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import type { Tables, AppRole, WithdrawalDestinationType } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { cn, formatDate, formatDateTime, formatQuantity } from '../../lib/utils'
import { buildPublicStorageUrl } from '../../lib/storage'
import { Button, Badge, DataTable, Modal, Card, Alert, Spinner, Select, Input } from '../../components/ui'
import { UserIcon, HelmetIcon, PackageIcon, ClipboardIcon, ChartIcon, CameraIcon, SignatureIcon } from '../../components/icons'
import { ItemVisual } from '../../components/items/ItemVisual'
import { PersonForm } from './PersonForm'
import { PersonInventoryModal } from './PersonInventoryModal'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { startOfWeek, startOfMonth, subWeeks, subMonths, parseISO, isAfter } from 'date-fns'

type PersonWithDetails = Omit<Tables<'people'>, 'document_attachments'> & {
  document_attachments: PersonAttachment[]
  inventory: (Tables<'person_inventories'> & {
    stock_items: Tables<'stock_items'>
  })[]
}

type WithdrawalRow = Tables<'withdrawals'> & {
  withdrawal_items: (Tables<'withdrawal_items'> & {
    stock_items: Tables<'stock_items'>
  })[]
  collaborator: Tables<'people'> | null
  work_site: Tables<'work_sites'> | null
}

type ConsumptionData = {
  name: string
  quantity: number
}

type InventoryWithdrawalTrace = {
  id: string
  withdrawalId: string
  code: string
  quantity: number
  unit: string
  createdAt: string
  requestedBy: string
  status: string
  notes: string | null
}

type TabType = 'profile' | 'inventory' | 'withdrawals' | 'consumption'
type DatePeriod = 'week' | 'month' | 'custom'
type InventoryActionMode = 'delete' | 'return_to_stock' | null

interface CustomDateRange {
  from: string
  to: string
}

function getJobTitleLabel(jobTitle: string | null): string {
  if (!jobTitle) return '-'
  if (jobTitle === 'cabista') return 'Cabista'
  if (jobTitle === 'ajudante de cabista') return 'Ajudante de cabista'
  return jobTitle
}

export function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [person, setPerson] = useState<PersonWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('profile')

  const [showEditModal, setShowEditModal] = useState(false)
  const [showToggleModal, setShowToggleModal] = useState(false)
  const [showInventoryModal, setShowInventoryModal] = useState(false)
  const [showInventoryActionModal, setShowInventoryActionModal] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [inventorySubmitting, setInventorySubmitting] = useState(false)
  const [inventoryActionMode, setInventoryActionMode] = useState<InventoryActionMode>(null)
  const [inventoryActionQuantity, setInventoryActionQuantity] = useState('1')
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<PersonWithDetails['inventory'][0] | null>(null)

  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false)
  const [inventoryTraces, setInventoryTraces] = useState<Record<string, InventoryWithdrawalTrace[]>>({})
  const [activeInventoryInfoId, setActiveInventoryInfoId] = useState<string | null>(null)
  const [pinnedInventoryInfoId, setPinnedInventoryInfoId] = useState<string | null>(null)

  const [datePeriod, setDatePeriod] = useState<DatePeriod>('month')
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange>({
    from: '',
    to: '',
  })
  const [consumptionData, setConsumptionData] = useState<ConsumptionData[]>([])

  const fetchPerson = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('people')
      .select('*, person_inventories(*, stock_items(*))')
      .eq('id', id)
      .single()

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    if (!data) {
      setError('Pessoa nao encontrada')
      setLoading(false)
      return
    }

    const raw = data as unknown as RawPersonDetailRow
    const enriched: PersonWithDetails = {
      id: raw.id,
      full_name: raw.full_name,
      employee_id: raw.employee_id,
      profile_id: raw.profile_id,
      role: raw.role,
      job_title: raw.job_title,
      sector: raw.sector,
      cpf: raw.cpf,
      photo_url: raw.photo_url,
      document_attachments: readAttachments(raw.document_attachments),
      is_active: raw.is_active,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      inventory: (raw.person_inventories ?? [])
        .filter((inv) => inv.stock_items?.is_active)
        .map((inv) => ({
          id: inv.id,
          person_id: inv.person_id,
          stock_item_id: inv.stock_item_id,
          quantity: inv.quantity,
          last_withdrawal_id: inv.last_withdrawal_id,
          updated_at: inv.updated_at,
          stock_items: inv.stock_items as Tables<'stock_items'>,
        })),
    }

    const stockItemIds = enriched.inventory.map((item) => item.stock_item_id)

    if (stockItemIds.length > 0) {
      const { data: traceData } = await supabase
        .from('withdrawal_items')
        .select(`
          id,
          stock_item_id,
          quantity,
          unit,
          created_at,
          withdrawal:withdrawals(
            id,
            code,
            status,
            created_at,
            notes,
            requested_by_person:people!withdrawals_requested_by_fkey(full_name, employee_id)
          )
        `)
        .eq('destination_type', 'collaborator')
        .eq('collaborator_id', id)
        .in('stock_item_id', stockItemIds)
        .order('created_at', { ascending: false })

      const nextTraces: Record<string, InventoryWithdrawalTrace[]> = {}

      for (const row of ((traceData ?? []) as unknown as RawInventoryWithdrawalTraceRow[])) {
        const withdrawal = row.withdrawal
        if (!withdrawal || withdrawal.status === 'rejected') continue

        if (!nextTraces[row.stock_item_id]) {
          nextTraces[row.stock_item_id] = []
        }

        nextTraces[row.stock_item_id].push({
          id: row.id,
          withdrawalId: withdrawal.id,
          code: withdrawal.code,
          quantity: row.quantity,
          unit: row.unit,
          createdAt: withdrawal.created_at,
          requestedBy: withdrawal.requested_by_person
            ? `${withdrawal.requested_by_person.full_name}${withdrawal.requested_by_person.employee_id ? ` (${withdrawal.requested_by_person.employee_id})` : ''}`
            : 'Nao informado',
          status: withdrawal.status,
          notes: withdrawal.notes,
        })
      }

      setInventoryTraces(nextTraces)
    } else {
      setInventoryTraces({})
    }

    setPerson(enriched)
    setLoading(false)
  }, [id])

  const fetchWithdrawals = useCallback(async () => {
    if (!id || !person) return
    if (person.role !== 'leader') return

    setWithdrawalsLoading(true)

    const { data, error: fetchError } = await supabase
      .from('withdrawals')
      .select('*, withdrawal_items(*, stock_items(*)), collaborator:people!withdrawals_collaborator_id_fkey(*), work_site:work_sites!withdrawals_work_site_id_fkey(*)')
      .eq('requested_by', id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setWithdrawalsLoading(false)
      return
    }

    const mapped: WithdrawalRow[] = (data ?? []).map((row) => {
      const raw = row as unknown as RawWithdrawalRow
  return {
    id: raw.id,
    code: raw.code,
    requested_by: raw.requested_by,
    collaborator_id: raw.collaborator_id,
    work_site_id: raw.work_site_id,
    destination_type: raw.destination_type as WithdrawalDestinationType,
    authorized_by: raw.authorized_by,
    sector: raw.sector,
    status: raw.status as 'pending' | 'approved' | 'rejected' | 'completed',
    notes: raw.notes,
    photo_url: raw.photo_url,
    photo_urls: raw.photo_urls ?? [],
    supervisor_signature: raw.supervisor_signature,
    supervisor_signature_attachment_url: raw.supervisor_signature_attachment_url,
    supervisor_signature_attachment_name: raw.supervisor_signature_attachment_name,
    requester_signature: raw.requester_signature,
    requester_signature_attachment_url: raw.requester_signature_attachment_url,
    requester_signature_attachment_name: raw.requester_signature_attachment_name,
    witness_signature: raw.witness_signature,
    withdrawn_at: raw.withdrawn_at,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
        withdrawal_items: (raw.withdrawal_items ?? []).map((item) => ({
          id: item.id,
          withdrawal_id: item.withdrawal_id,
          stock_item_id: item.stock_item_id,
          lot_id: item.lot_id,
          quantity: item.quantity,
          unit: item.unit,
          destination_type: item.destination_type as WithdrawalDestinationType | null,
          collaborator_id: item.collaborator_id,
          work_site_id: item.work_site_id,
          created_at: item.created_at,
          stock_items: item.stock_items as Tables<'stock_items'>,
        })),
        collaborator: raw.collaborator as Tables<'people'> | null,
        work_site: raw.work_site as Tables<'work_sites'> | null,
      }
    })

    setWithdrawals(mapped)
    setWithdrawalsLoading(false)
  }, [id, person])

  useEffect(() => {
    setTimeout(() => void fetchPerson(), 0)
  }, [fetchPerson])

  useEffect(() => {
    if (person && person.role === 'leader') {
      setTimeout(() => void fetchWithdrawals(), 0)
    }
  }, [person, fetchWithdrawals])

  const getFilteredWithdrawals = useMemo(() => {
    let startDate: Date
    const now = new Date()

    if (datePeriod === 'week') {
      startDate = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })
    } else if (datePeriod === 'month') {
      startDate = startOfMonth(subMonths(now, 1))
    } else {
      if (customDateRange.from && customDateRange.to) {
        startDate = parseISO(customDateRange.from)
        const endDate = parseISO(customDateRange.to)
        return withdrawals.filter((w) => {
          const createdDate = parseISO(w.created_at)
          return isAfter(createdDate, startDate) && isAfter(endDate, createdDate)
        })
      }
      startDate = startOfMonth(subMonths(now, 1))
    }

    return withdrawals.filter((w) => {
      const createdDate = parseISO(w.created_at)
      return isAfter(createdDate, startDate)
    })
  }, [withdrawals, datePeriod, customDateRange])

  useEffect(() => {
    const filtered = getFilteredWithdrawals
    const itemMap: Record<string, { name: string; quantity: number }> = {}

    for (const w of filtered) {
      for (const item of w.withdrawal_items) {
        const itemId = item.stock_item_id
        if (!itemMap[itemId]) {
          itemMap[itemId] = { name: item.stock_items.name, quantity: 0 }
        }
        itemMap[itemId].quantity += item.quantity
      }
    }

    const chartData: ConsumptionData[] = Object.values(itemMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10)

    setTimeout(() => setConsumptionData(chartData), 0)
  }, [getFilteredWithdrawals])

  const handleToggleActive = async () => {
    if (!person) return
    setToggling(true)

    const { error: updateError } = await supabase
      .from('people')
      .update({ is_active: !person.is_active, updated_at: new Date().toISOString() })
      .eq('id', person.id)

    if (updateError) {
      setError(updateError.message)
      setToggling(false)
      return
    }

    setPerson((prev) => (prev ? { ...prev, is_active: !prev.is_active } : prev))
    setToggling(false)
    setShowToggleModal(false)
  }

  const handleEditSubmit = (_result: Tables<'people'>) => {
    setShowEditModal(false)
    void fetchPerson()
  }

  const openInventoryActionModal = (inventoryItem: PersonWithDetails['inventory'][0]) => {
    setSelectedInventoryItem(inventoryItem)
    setInventoryActionQuantity('1')
    setInventoryActionMode(null)
    setShowInventoryActionModal(true)
  }

  const toggleInventoryInfo = (inventoryId: string) => {
    setPinnedInventoryInfoId((current) => current === inventoryId ? null : inventoryId)
    setActiveInventoryInfoId(inventoryId)
  }

  const handleInventoryAction = async (mode: Exclude<InventoryActionMode, null>) => {
    if (!selectedInventoryItem || !person) return

    const quantity = Number.parseInt(inventoryActionQuantity, 10)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Informe uma quantidade valida para retirar do inventario.')
      return
    }

    if (quantity > selectedInventoryItem.quantity) {
      setError(`Quantidade acima do inventario atual. Maximo: ${selectedInventoryItem.quantity}.`)
      return
    }

    setInventorySubmitting(true)
    setInventoryActionMode(mode)
    setError(null)

    const { error: actionError } = await supabase.rpc('remove_inventory_item_from_person', {
      p_person_id: person.id,
      p_stock_item_id: selectedInventoryItem.stock_item_id,
      p_quantity: quantity,
      p_destination: mode,
    })

    if (actionError) {
      setError(actionError.message)
      setInventorySubmitting(false)
      return
    }

    setInventorySubmitting(false)
    setShowInventoryActionModal(false)
    setSelectedInventoryItem(null)
    setInventoryActionMode(null)
    await fetchPerson()
  }

  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  const getDestinationLabel = (w: WithdrawalRow): string => {
    if (w.destination_type === 'collaborator' && w.collaborator) {
      return w.collaborator.full_name
    }
    if (w.destination_type === 'work_site') {
      return 'obra jamaaw'
    }
    return '-'
  }

  const getItemsSummary = (w: WithdrawalRow): string => {
    const items = w.withdrawal_items
    if (items.length === 0) return 'Nenhum item'
    if (items.length === 1) return `${items[0].stock_items.name} (${items[0].quantity} ${items[0].unit})`
    const first = items[0]
    return `${first.stock_items.name} +${items.length - 1} item(ns)`
  }

  const statusBadgeMap: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'warning',
    approved: 'info',
    completed: 'success',
    rejected: 'danger',
  }

  const statusLabelMap: Record<string, string> = {
    pending: 'Pendente',
    approved: 'Aprovada',
    completed: 'Concluida',
    rejected: 'Rejeitada',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error && !person) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="danger">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate('/people')}>
          Voltar para Colaboradores
        </Button>
      </div>
    )
  }

  if (!person) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-gray-400">Pessoa nao encontrada.</p>
        <Button variant="secondary" onClick={() => navigate('/people')}>
          Voltar para Colaboradores
        </Button>
      </div>
    )
  }

  const isLeader = person.role === 'leader'

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = isLeader
    ? [
        { key: 'withdrawals', label: 'Retiradas Realizadas', icon: <ClipboardIcon size={16} /> },
        { key: 'consumption', label: 'Resumo de Consumo', icon: <ChartIcon size={16} /> },
        { key: 'profile', label: 'Dados Cadastrais', icon: <UserIcon size={16} /> },
      ]
    : [
        { key: 'inventory', label: 'Inventario Individual', icon: <PackageIcon size={16} /> },
        { key: 'profile', label: 'Dados Cadastrais', icon: <UserIcon size={16} /> },
      ]

  const inventoryColumns = [
    {
      key: 'stock_items.svg_icon_key',
      header: '',
      render: (_value: unknown, row: PersonWithDetails['inventory'][0]) => (
        <ItemVisual iconKey={row.stock_items.svg_icon_key} size={28} />
      ),
    },
    {
      key: 'stock_items.name',
      header: 'Item',
      sortable: true,
      render: (_value: unknown, row: PersonWithDetails['inventory'][0]) => (
        <span className="font-medium text-white">{row.stock_items.name}</span>
      ),
    },
    {
      key: 'stock_items.code',
      header: 'Codigo',
      render: (_value: unknown, row: PersonWithDetails['inventory'][0]) => (
        <span className="font-mono text-gray-400">{row.stock_items.code}</span>
      ),
    },
    {
      key: 'stock_items.category',
      header: 'Categoria',
      render: (_value: unknown, row: PersonWithDetails['inventory'][0]) =>
        row.stock_items.category ?? '-',
    },
    {
      key: 'quantity',
      header: 'Quantidade',
      render: (_value: unknown, row: PersonWithDetails['inventory'][0]) => {
        const traces = inventoryTraces[row.stock_item_id] ?? []
        const isOpen = activeInventoryInfoId === row.id || pinnedInventoryInfoId === row.id

        return (
          <InventoryQuantityInfo
            inventory={row}
            traces={traces}
            isOpen={isOpen}
            isPinned={pinnedInventoryInfoId === row.id}
            onMouseEnter={() => setActiveInventoryInfoId(row.id)}
            onMouseLeave={() => {
              if (pinnedInventoryInfoId !== row.id) setActiveInventoryInfoId(null)
            }}
            onToggle={() => toggleInventoryInfo(row.id)}
          />
        )
      },
    },
    {
      key: 'updated_at',
      header: 'Ultima Atualizacao',
      sortable: true,
      render: (value: unknown) => formatDate(value as string),
    },
    {
      key: 'actions',
      header: 'Acao',
      className: 'text-right',
      render: (_value: unknown, row: PersonWithDetails['inventory'][0]) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openInventoryActionModal(row)
          }}
          className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-200 transition-colors hover:bg-orange-500/16"
        >
          Retirar
        </button>
      ),
    },
  ]

  const withdrawalColumns = [
    {
      key: 'code',
      header: 'Codigo',
      sortable: true,
      render: (value: unknown) => (
        <span className="font-mono text-sm text-orange-400">{value as string}</span>
      ),
    },
    {
      key: 'created_at',
      header: 'Data',
      sortable: true,
      render: (value: unknown) => formatDateTime(value as string),
    },
    {
      key: 'destination',
      header: 'Destino',
      render: (_value: unknown, row: WithdrawalRow) => getDestinationLabel(row),
    },
    {
      key: 'items',
      header: 'Itens',
      render: (_value: unknown, row: WithdrawalRow) => getItemsSummary(row),
    },
    {
      key: 'status',
      header: 'Status',
      render: (value: unknown) => {
        const status = value as string
        return (
          <Badge variant={statusBadgeMap[status] ?? 'default'}>
            {statusLabelMap[status] ?? status}
          </Badge>
        )
      },
    },
    {
      key: 'attachments',
      header: '',
      render: (_value: unknown, row: WithdrawalRow) => (
        <div className="flex items-center gap-2">
          {row.photo_url && (
            <span title="Possui foto" className="text-blue-400">
              <CameraIcon size={16} />
            </span>
          )}
          {(row.supervisor_signature || row.requester_signature || row.witness_signature) && (
            <span title="Possui assinatura" className="text-emerald-400">
              <SignatureIcon size={16} />
            </span>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/people')}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 className="text-2xl font-bold text-white">Detalhes do Colaborador</h2>
      </div>

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card variant="bordered" padding="lg">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {person.photo_url ? (
              <img
                src={person.photo_url}
                alt={person.full_name}
                className="h-16 w-16 rounded-full object-cover ring-2 ring-gray-700"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-800 text-xl font-bold text-gray-300 ring-2 ring-gray-700">
                {getInitials(person.full_name)}
              </div>
            )}
            <div>
              <h3 className="text-xl font-bold text-white">{person.full_name}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {person.employee_id && (
                  <span className="text-sm text-gray-400">Matricula: {person.employee_id}</span>
                )}
                <Badge variant={person.role === 'leader' ? 'primary' : 'info'} dot>
                  {person.role === 'leader' ? (
                    <>
                      <HelmetIcon size={12} className="mr-1 inline-block" />
                      Lider
                    </>
                  ) : (
                    <>
                      <UserIcon size={12} className="mr-1 inline-block" />
                      Colaborador
                    </>
                  )}
                </Badge>
                <Badge variant={person.is_active ? 'success' : 'danger'} dot>
                  {person.is_active ? 'Ativo' : 'Inativo'}
                </Badge>
                {person.role !== 'leader' && person.job_title && (
                  <span className="rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-sm text-gray-300">
                    Funcao: {getJobTitleLabel(person.job_title)}
                  </span>
                )}
                {person.sector && (
                  <span className="rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-sm text-gray-300">
                    Setor: {person.sector}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowEditModal(true)}
            >
              Editar
            </Button>
            <Button
              variant={person.is_active ? 'danger' : 'primary'}
              size="sm"
              onClick={() => setShowToggleModal(true)}
              isLoading={toggling}
            >
              {person.is_active ? 'Desativar' : 'Reativar'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex gap-1 border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'border-orange-500 text-orange-500'
                : 'border-transparent text-gray-400 hover:text-gray-300',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <Card variant="bordered" padding="lg">
          <h3 className="mb-4 text-lg font-semibold text-white">Dados Cadastrais</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Nome Completo" value={person.full_name} />
            <DetailField label="Matricula" value={person.employee_id ?? '-'} />
            <DetailField label="CPF" value={formatCpf(person.cpf)} />
            <DetailField label="Cargo" value={person.role === 'leader' ? 'Lider' : 'Colaborador'} />
            <DetailField label="Setor" value={person.sector ?? '-'} />
            <DetailField label="Status" value={person.is_active ? 'Ativo' : 'Inativo'} />
            <DetailField label="Criado em" value={formatDateTime(person.created_at)} />
            <DetailField label="Atualizado em" value={formatDateTime(person.updated_at)} />
          </div>

          <div className="mt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-300/80">Documentos anexados</h4>
              <Button variant="secondary" size="sm" onClick={() => setShowEditModal(true)}>
                Renomear ou remover
              </Button>
            </div>
            {person.document_attachments.length > 0 ? (
              <div className="mt-3 grid gap-3">
                {person.document_attachments.map((document, index) => (
                  <a
                    key={`${document.url}-${index}`}
                    href={buildPublicStorageUrl(document.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-gray-200 transition-colors hover:border-orange-400/30 hover:bg-white/6"
                  >
                    <span className="truncate">{document.name}</span>
                    <span className="ml-3 shrink-0 text-orange-300">Abrir</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/3 px-4 py-4 text-sm text-gray-500">
                Nenhum documento anexado para este colaborador.
              </div>
            )}
          </div>
        </Card>
      )}

      {activeTab === 'inventory' && !isLeader && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Inventario Individual</h3>
            <Button
              size="sm"
              leftIcon={<PackageIcon size={14} />}
              onClick={() => setShowInventoryModal(true)}
            >
              Adicionar Itens e Kits
            </Button>
          </div>

          <DataTable<PersonWithDetails['inventory'][0]>
            columns={inventoryColumns}
            data={person.inventory}
            keyExtractor={(row) => row.id}
            isLoading={false}
            emptyMessage="Nenhum item no inventario desta pessoa"
          />
        </div>
      )}

      {activeTab === 'withdrawals' && isLeader && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Retiradas Realizadas</h3>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[120px]">
              <Select
                label="Periodo"
                value={datePeriod}
                onChange={(e) => setDatePeriod(e.target.value as DatePeriod)}
                options={[
                  { value: 'week', label: 'Ultima semana' },
                  { value: 'month', label: 'Ultimo mes' },
                  { value: 'custom', label: 'Personalizado' },
                ]}
              />
            </div>
            {datePeriod === 'custom' && (
              <>
                <Input
                  label="Data inicio"
                  type="date"
                  value={customDateRange.from}
                  onChange={(e) =>
                    setCustomDateRange((prev) => ({ ...prev, from: e.target.value }))
                  }
                />
                <Input
                  label="Data fim"
                  type="date"
                  value={customDateRange.to}
                  onChange={(e) =>
                    setCustomDateRange((prev) => ({ ...prev, to: e.target.value }))
                  }
                />
              </>
            )}
          </div>

          <DataTable<WithdrawalRow>
            columns={withdrawalColumns}
            data={getFilteredWithdrawals}
            keyExtractor={(row) => row.id}
            isLoading={withdrawalsLoading}
            emptyMessage="Nenhuma retirada encontrada no periodo selecionado"
            onRowClick={(row) => navigate(`/withdrawals/${row.id}`)}
          />
        </div>
      )}

      {activeTab === 'consumption' && isLeader && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Resumo de Consumo</h3>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[120px]">
              <Select
                label="Periodo"
                value={datePeriod}
                onChange={(e) => setDatePeriod(e.target.value as DatePeriod)}
                options={[
                  { value: 'week', label: 'Ultima semana' },
                  { value: 'month', label: 'Ultimo mes' },
                  { value: 'custom', label: 'Personalizado' },
                ]}
              />
            </div>
            {datePeriod === 'custom' && (
              <>
                <Input
                  label="Data inicio"
                  type="date"
                  value={customDateRange.from}
                  onChange={(e) =>
                    setCustomDateRange((prev) => ({ ...prev, from: e.target.value }))
                  }
                />
                <Input
                  label="Data fim"
                  type="date"
                  value={customDateRange.to}
                  onChange={(e) =>
                    setCustomDateRange((prev) => ({ ...prev, to: e.target.value }))
                  }
                />
              </>
            )}
          </div>

          {consumptionData.length === 0 ? (
            <Card variant="bordered" padding="lg">
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ChartIcon size={48} className="mb-3 text-gray-600" />
                <p className="text-sm text-gray-400">
                  Nenhum dado de consumo para o periodo selecionado.
                </p>
              </div>
            </Card>
          ) : (
            <Card variant="bordered" padding="lg">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={consumptionData} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                      height={80}
                    />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1F2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#F3F4F6',
                      }}
                      labelStyle={{ color: '#F97316' }}
                    />
                    <Bar dataKey="quantity" fill="#F97316" radius={[4, 4, 0, 0]} name="Quantidade" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      )}

      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Editar Colaborador"
        size="lg"
      >
        <PersonForm
          person={person}
          onSubmit={handleEditSubmit}
          onCancel={() => setShowEditModal(false)}
        />
      </Modal>

      <Modal
        isOpen={showToggleModal}
        onClose={() => setShowToggleModal(false)}
        title={person.is_active ? 'Desativar Colaborador' : 'Reativar Colaborador'}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-300">
            Tem certeza que deseja {person.is_active ? 'desativar' : 'reativar'}{' '}
            <span className="font-medium text-white">{person.full_name}</span>?
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setShowToggleModal(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={person.is_active ? 'danger' : 'primary'}
              onClick={() => void handleToggleActive()}
              isLoading={toggling}
            >
              {person.is_active ? 'Desativar' : 'Reativar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showInventoryModal}
        onClose={() => setShowInventoryModal(false)}
        title="Adicionar Itens e Kits ao Inventario"
        size="xl"
      >
        <PersonInventoryModal
          onClose={() => setShowInventoryModal(false)}
          personId={person.id}
          personName={person.full_name}
          onAdded={() => void fetchPerson()}
        />
      </Modal>

      <Modal
        isOpen={showInventoryActionModal}
        onClose={() => {
          setShowInventoryActionModal(false)
          setSelectedInventoryItem(null)
          setInventoryActionMode(null)
        }}
        title="Retirar item do inventario"
        size="sm"
      >
        {selectedInventoryItem && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/8 bg-[#111217] p-4">
              <div className="flex items-center gap-3">
                <ItemVisual iconKey={selectedInventoryItem.stock_items.svg_icon_key} size={34} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{selectedInventoryItem.stock_items.name}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Disponivel no colaborador: {formatQuantity(selectedInventoryItem.quantity, selectedInventoryItem.stock_items.unit)}
                  </p>
                </div>
              </div>
            </div>

            <Input
              label="Quantidade para retirar"
              type="number"
              min={1}
              max={selectedInventoryItem.quantity}
              value={inventoryActionQuantity}
              onChange={(event) => setInventoryActionQuantity(event.target.value)}
            />

            <p className="text-sm text-gray-400">
              Escolha o destino dos itens retirados deste inventario antes de confirmar a movimentacao.
            </p>

            <div className="grid gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleInventoryAction('return_to_stock')}
                isLoading={inventorySubmitting && inventoryActionMode === 'return_to_stock'}
              >
                Devolver ao estoque
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void handleInventoryAction('delete')}
                isLoading={inventorySubmitting && inventoryActionMode === 'delete'}
              >
                Excluir definitivamente
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase text-gray-500">{label}</span>
      <span className="text-sm text-gray-200">{value}</span>
    </div>
  )
}

function InventoryQuantityInfo({
  inventory,
  traces,
  isOpen,
  isPinned,
  onMouseEnter,
  onMouseLeave,
  onToggle,
}: {
  inventory: PersonWithDetails['inventory'][0]
  traces: InventoryWithdrawalTrace[]
  isOpen: boolean
  isPinned: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onToggle: () => void
}) {
  const withdrawalTotal = traces.reduce((sum, trace) => sum + trace.quantity, 0)
  const manualOrAdjustedQuantity = inventory.quantity - withdrawalTotal
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [cardPosition, setCardPosition] = useState({
    top: 0,
    bottom: undefined as number | undefined,
    left: 0,
    maxHeight: 360,
    placement: 'below' as 'above' | 'below',
  })

  const updateCardPosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    const cardWidth = Math.min(520, window.innerWidth - 48)
    const left = Math.min(Math.max(rect.left, 16), window.innerWidth - cardWidth - 16)
    const gap = 10
    const viewportPadding = 12
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
    const spaceAbove = rect.top - viewportPadding
    const shouldOpenAbove = spaceBelow < 360 && spaceAbove > spaceBelow
    const availableSpace = shouldOpenAbove ? spaceAbove : spaceBelow

    setCardPosition({
      top: shouldOpenAbove ? 0 : rect.bottom + gap,
      bottom: shouldOpenAbove ? window.innerHeight - rect.top + gap : undefined,
      left,
      maxHeight: Math.max(180, Math.min(560, availableSpace - gap)),
      placement: shouldOpenAbove ? 'above' : 'below',
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    updateCardPosition()
    window.addEventListener('scroll', updateCardPosition, true)
    window.addEventListener('resize', updateCardPosition)

    return () => {
      window.removeEventListener('scroll', updateCardPosition, true)
      window.removeEventListener('resize', updateCardPosition)
    }
  }, [isOpen, updateCardPosition])

  const infoCard = isOpen
    ? createPortal(
      <div
        className="fixed z-[9999] flex w-[min(520px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-orange-400/25 bg-[#101114] opacity-100 shadow-[0_24px_70px_rgba(0,0,0,0.55)] transition-all duration-300"
        style={{
          top: cardPosition.placement === 'below' ? cardPosition.top : undefined,
          bottom: cardPosition.placement === 'above' ? cardPosition.bottom : undefined,
          left: cardPosition.left,
          maxHeight: cardPosition.maxHeight,
          transform: 'translateY(0) scale(1)',
          transformOrigin: cardPosition.placement === 'above' ? 'bottom left' : 'top left',
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.18),_transparent_58%)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-orange-200/75">
                Origem no inventario
              </p>
              <p className="mt-1 text-sm font-semibold text-white">{inventory.stock_items.name}</p>
            </div>
            {isPinned ? (
              <Badge variant="warning" size="sm">Fixado</Badge>
            ) : (
              <Badge variant="info" size="sm">Passe/click</Badge>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <InventoryInfoMetric label="Atual" value={formatQuantity(inventory.quantity, inventory.stock_items.unit)} />
            <InventoryInfoMetric label="Retiradas" value={formatQuantity(withdrawalTotal, inventory.stock_items.unit)} />
            <InventoryInfoMetric
              label="Manual/Ajuste"
              value={formatQuantity(Math.max(manualOrAdjustedQuantity, 0), inventory.stock_items.unit)}
              muted={manualOrAdjustedQuantity <= 0}
            />
          </div>

          {manualOrAdjustedQuantity < 0 ? (
            <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              O historico de retiradas passa do saldo atual. Parte desse item pode ter sido devolvida, removida ou ajustada depois.
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {traces.length === 0 ? (
            <div className="rounded-xl border border-white/8 bg-white/3 p-3 text-xs text-gray-400">
              Nao ha retirada registrada para este item neste colaborador. Este saldo provavelmente veio de adicao manual, kit ou ajuste direto de inventario.
            </div>
          ) : (
            <div className="space-y-2">
              {traces.map((trace) => (
                <div key={trace.id} className="rounded-xl border border-white/8 bg-white/4 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-orange-300">{trace.code}</p>
                      <p className="mt-1 text-xs text-gray-400">{formatDateTime(trace.createdAt)}</p>
                    </div>
                    <span className="rounded-lg bg-black/25 px-2 py-1 text-xs font-semibold text-white">
                      {formatQuantity(trace.quantity, trace.unit)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-300">
                    Solicitado por: <span className="text-white">{trace.requestedBy}</span>
                  </p>
                  {trace.notes ? (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{trace.notes}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>,
      document.body,
    )
    : null

  return (
    <div
      className="relative min-w-[260px]"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          updateCardPosition()
          onToggle()
        }}
        className={cn(
          'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all duration-200',
          isOpen
            ? 'border-orange-400/45 bg-orange-500/15 text-orange-100 shadow-[0_0_28px_rgba(249,115,22,0.18)]'
            : 'border-orange-400/15 bg-orange-500/8 text-orange-300 hover:border-orange-400/35 hover:bg-orange-500/12',
        )}
      >
        <span className="font-semibold">
          {formatQuantity(inventory.quantity, inventory.stock_items.unit)}
        </span>
        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-400">
          {traces.length > 0 ? `${traces.length} retirada(s)` : 'manual'}
        </span>
      </button>

      {infoCard}
    </div>
  )
}

function InventoryInfoMetric({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <p className={cn('mt-1 truncate text-xs font-semibold', muted ? 'text-gray-500' : 'text-white')}>{value}</p>
    </div>
  )
}

interface RawPersonDetailRow {
  id: string
  full_name: string
  employee_id: string | null
  profile_id: string | null
  role: AppRole
  job_title: string | null
  sector: string | null
  cpf: string | null
  photo_url: string | null
  document_attachments: Record<string, unknown>[]
  is_active: boolean
  created_at: string
  updated_at: string
  person_inventories: {
    id: string
    person_id: string
    stock_item_id: string
    quantity: number
    last_withdrawal_id: string | null
    updated_at: string
    stock_items: Tables<'stock_items'>
  }[]
}

interface RawInventoryWithdrawalTraceRow {
  id: string
  stock_item_id: string
  quantity: number
  unit: string
  created_at: string
  withdrawal: {
    id: string
    code: string
    status: string
    created_at: string
    notes: string | null
    requested_by_person: {
      full_name: string
      employee_id: string | null
    } | null
  } | null
}

type PersonAttachment = {
  name: string
  url: string
}

function formatCpf(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 11)
  if (digits.length !== 11) return value ?? '-'
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

interface RawWithdrawalRow {
  id: string
  code: string
  requested_by: string
  collaborator_id: string | null
  work_site_id: string | null
  destination_type: string
  authorized_by: string | null
  sector: string | null
  status: string
  notes: string | null
  photo_url: string | null
  photo_urls?: string[]
  supervisor_signature: string | null
  supervisor_signature_attachment_url: string | null
  supervisor_signature_attachment_name: string | null
  requester_signature: string | null
  requester_signature_attachment_url: string | null
  requester_signature_attachment_name: string | null
  witness_signature: string | null
  withdrawn_at: string | null
  created_at: string
  updated_at: string
  withdrawal_items: {
    id: string
    withdrawal_id: string
    stock_item_id: string
    lot_id: string | null
    quantity: number
    unit: string
    destination_type: string | null
    collaborator_id: string | null
    work_site_id: string | null
    created_at: string
    stock_items: Tables<'stock_items'>
  }[]
  collaborator: Tables<'people'> | null
  work_site: Tables<'work_sites'> | null
}
