import { useEffect, useState, useCallback } from 'react'
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { cn, formatQuantity, formatDateTime } from '../../lib/utils'
import {
  Button,
  Input,
  Alert,
  Badge,
  Card,
  Modal,
  DataTable,
  EmptyState,
  Spinner,
} from '../../components/ui'
import { PackageIcon } from '../../components/icons'
import { StockItemForm } from './StockItemForm'
import alicateImg from '../../assets/alicate.png'
import capceteImg from '../../assets/capcete.png'
import materialImg from '../../assets/material.png'
import fardamentoImg from '../../assets/fardamento.png'

type StockItemRow = Tables<'stock_items'>

interface StockItemWithLowStock extends StockItemRow {
  is_low_stock: boolean
}

interface WithdrawalWithDetails {
  id: string
  code: string | null
  status: string
  created_at: string
  requested_by_person: { full_name: string } | null
  quantity: number
}

type ModalMode = 'detail' | 'create' | 'edit' | 'delete'

const CATEGORY_FILTER_OPTIONS = [
  { value: '', label: 'Todas as categorias' },
  { value: 'EPI', label: 'EPI' },
  { value: 'Ferramenta', label: 'Ferramenta' },
  { value: 'Material', label: 'Material' },
  { value: 'Outro', label: 'Outro' },
]

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
]

type StockRowRecord = StockItemWithLowStock & Record<string, unknown>

const ICON_MAP: Record<string, string> = {
  capacete: capceteImg,
  alicate: alicateImg,
  material: materialImg,
  fardamento: fardamentoImg,
  helmet: capceteImg,
  pliers: alicateImg,
  vest: fardamentoImg,
}

function ItemIcon({ iconKey, size = 28 }: { iconKey: string | null; size?: number }) {
  if (!iconKey) return <PackageIcon size={Math.round(size * 0.6)} />
  if (iconKey.startsWith('data:image/')) {
    return <img src={iconKey} alt="foto" style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4 }} />
  }
  const src = ICON_MAP[iconKey]
  if (src) {
    return <img src={src} alt={iconKey} style={{ width: size, height: size, objectFit: 'contain' }} draggable={false} />
  }
  return <PackageIcon size={Math.round(size * 0.6)} />
}

export function StockPage() {
  const { profile } = useAuth()

  const [items, setItems] = useState<StockItemWithLowStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')

  const [modalMode, setModalMode] = useState<ModalMode | null>(null)
  const [selectedItem, setSelectedItem] = useState<StockItemRow | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [itemLots, setItemLots] = useState<Tables<'stock_item_lots'>[]>([])
  const [itemWithdrawals, setItemWithdrawals] = useState<WithdrawalWithDetails[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('stock_items')
      .select('*')
      .order('name', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const mapped = ((data as unknown as StockItemRow[]) ?? []).map((item) => ({
      ...item,
      is_low_stock: item.minimum_quantity > 0 && item.current_quantity <= item.minimum_quantity,
    }))

    setItems(mapped)
    setLoading(false)
  }, [])

  useEffect(() => {
    setTimeout(() => void fetchItems(), 0)
  }, [fetchItems])

  const fetchItemDetails = useCallback(async (itemId: string) => {
    setDetailLoading(true)

    const [lotsResult, withdrawalItemsResult] = await Promise.all([
      supabase
        .from('stock_item_lots')
        .select('*')
        .eq('stock_item_id', itemId)
        .order('created_at', { ascending: false }),
      supabase
        .from('withdrawal_items')
        .select('quantity, withdrawal:withdrawals(id, code, status, created_at, requested_by_person:people!withdrawals_requested_by_fkey(full_name))')
        .eq('stock_item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    setItemLots(lotsResult.data ?? [])

    const typedWithdrawals: WithdrawalWithDetails[] = []
    if (withdrawalItemsResult.data) {
      for (const wi of withdrawalItemsResult.data) {
        const w = (wi as Record<string, unknown>).withdrawal as Record<string, unknown> | undefined
        if (w) {
          typedWithdrawals.push({
            id: w.id as string,
            code: w.code as string | null,
            status: w.status as string,
            created_at: w.created_at as string,
            requested_by_person: w.requested_by_person as { full_name: string } | null,
            quantity: (wi as { quantity: number }).quantity,
          })
        }
      }
    }
    setItemWithdrawals(typedWithdrawals)
    setDetailLoading(false)
  }, [])

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      searchQuery === '' ||
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.category ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.ca_nr ?? '').toLowerCase().includes(searchQuery.toLowerCase())

    const matchesCategory =
      categoryFilter === '' || item.category === categoryFilter

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && item.is_active !== false) ||
      (statusFilter === 'inactive' && item.is_active === false)

    return matchesSearch && matchesCategory && matchesStatus
  })

  const lowStockCount = items.filter((i) => i.is_low_stock).length

  const handleOpenCreate = () => {
    setSelectedItem(null)
    setSubmitError(null)
    setModalMode('create')
  }

  const handleOpenDetail = (item: StockItemRow) => {
    setSelectedItem(item)
    setSubmitError(null)
    setModalMode('detail')
    fetchItemDetails(item.id)
  }

  const handleOpenEdit = (item: StockItemRow) => {
    setSelectedItem(item)
    setSubmitError(null)
    setModalMode('edit')
  }

  const handleOpenDelete = (item: StockItemRow) => {
    setSelectedItem(item)
    setSubmitError(null)
    setModalMode('delete')
  }

  const handleCloseModal = () => {
    setModalMode(null)
    setSelectedItem(null)
    setSubmitError(null)
    setItemLots([])
    setItemWithdrawals([])
  }

  const handleCreateSubmit = async (data: TablesInsert<'stock_items'>) => {
    if (!profile?.id) {
      setSubmitError('Sessão expirada. Faça login novamente.')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const insertData: TablesInsert<'stock_items'> = {
        ...data,
        created_by: profile.id,
      }

      const { error: insertError } = await supabase
        .from('stock_items')
        .insert(insertData)

      if (insertError) {
        setSubmitError(insertError.message)
        return
      }

      handleCloseModal()
      fetchItems()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado ao criar item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditSubmit = async (data: TablesUpdate<'stock_items'>) => {
    if (!selectedItem) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const updateData: TablesUpdate<'stock_items'> = {
        ...data,
      }

      const { error: updateError } = await supabase
        .from('stock_items')
        .update(updateData)
        .eq('id', selectedItem.id)

      if (updateError) {
        setSubmitError(updateError.message)
        return
      }

      handleCloseModal()
      fetchItems()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado ao editar item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const { error: deleteError } = await supabase
        .from('stock_items')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedItem.id)

      if (deleteError) {
        setSubmitError(deleteError.message)
        return
      }

      handleCloseModal()
      fetchItems()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado ao desativar item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const quantityColor = (
    current: number,
    minimum: number
  ): 'text-emerald-400' | 'text-orange-400' | 'text-red-400' => {
    if (minimum <= 0) return 'text-emerald-400'
    if (current > minimum) return 'text-emerald-400'
    if (current === minimum) return 'text-orange-400'
    return 'text-red-400'
  }

  const categoryBadgeVariant = (
    category: string | null
  ): 'primary' | 'info' | 'success' | 'default' => {
    switch (category) {
      case 'EPI':
        return 'primary'
      case 'Ferramenta':
        return 'info'
      case 'Material':
        return 'success'
      default:
        return 'default'
    }
  }

  const columns = [
    {
      key: 'svg_icon_key',
      header: '',
      sortable: false,
      render: (_value: unknown, row: StockRowRecord) => (
        <ItemIcon iconKey={row.svg_icon_key as string | null} size={28} />
      ),
    },
    {
      key: 'code',
      header: 'Código',
      sortable: true,
      render: (_value: unknown, row: StockRowRecord) => (
        <span className="font-mono text-sm text-orange-400">{row.code}</span>
      ),
    },
    {
      key: 'name',
      header: 'Nome',
      sortable: true,
      render: (_value: unknown, row: StockRowRecord) => (
        <div className="flex items-center gap-2">
          {row.is_low_stock && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
            </span>
          )}
          <span className="font-medium text-white">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoria',
      render: (_value: unknown, row: StockRowRecord) => (
        <Badge
          variant={categoryBadgeVariant(row.category)}
          size="sm"
        >
          {row.category ?? '—'}
        </Badge>
      ),
    },
    {
      key: 'ca_nr',
      header: 'CA/NR',
      render: (_value: unknown, row: StockRowRecord) => (
        <span className="text-gray-300">{row.ca_nr ?? '—'}</span>
      ),
    },
    {
      key: 'current_quantity',
      header: 'Qtd Atual',
      sortable: true,
      render: (_value: unknown, row: StockRowRecord) => (
        <span
          className={cn(
            'font-semibold',
            quantityColor(row.current_quantity, row.minimum_quantity)
          )}
        >
          {formatQuantity(row.current_quantity, row.unit)}
        </span>
      ),
    },
    {
      key: 'minimum_quantity',
      header: 'Qtd Mínima',
      render: (_value: unknown, row: StockRowRecord) => (
        <span className="text-gray-400">
          {formatQuantity(row.minimum_quantity, row.unit)}
        </span>
      ),
    },
    {
      key: 'unit',
      header: 'Unidade',
      render: (_value: unknown, row: StockRowRecord) => (
        <span className="text-gray-300">{row.unit}</span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestão de Estoque</h2>
          <p className="mt-1 text-sm text-gray-400">
            Gerencie os itens do almoxarifado, lotes e níveis de estoque
          </p>
        </div>
        <Button onClick={handleOpenCreate} leftIcon={<PackageIcon size={16} />}>
          Novo Item
        </Button>
      </div>

      {lowStockCount > 0 && (
        <Alert variant="warning" title="Alerta de Estoque Baixo">
          {lowStockCount} item(ns) com estoque abaixo ou igual ao mínimo
        </Alert>
      )}

      {error && (
        <Alert variant="danger" title="Erro ao carregar itens">
          {error}
        </Alert>
      )}

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Input
              placeholder="Buscar por código, nome, categoria ou CA/NR..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    cx="6.5"
                    cy="6.5"
                    r="5.5"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M11 11L15 15"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              }
            />
          </div>
          <div className="flex gap-3">
            <div className="relative">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-10 text-sm text-white transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              >
                {CATEGORY_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M4 6L8 10L12 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-10 text-sm text-white transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              >
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M4 6L8 10L12 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-400">Carregando itens...</p>
        </div>
      ) : filteredItems.length === 0 && searchQuery === '' && categoryFilter === '' ? (
        <EmptyState
          icon={<PackageIcon size={48} />}
          title="Nenhum item cadastrado"
          description="Comece cadastrando o primeiro item do almoxarifado"
          action={{ label: 'Novo Item', onClick: handleOpenCreate }}
        />
      ) : (
        <DataTable<StockRowRecord>
          columns={columns}
          data={filteredItems as StockRowRecord[]}
          keyExtractor={(row) => row.id}
          isLoading={false}
          emptyMessage="Nenhum item encontrado com os filtros aplicados"
          onRowClick={(row) => handleOpenDetail(row as unknown as StockItemRow)}
        />
      )}

      {/* Create Modal */}
      <Modal
        isOpen={modalMode === 'create'}
        onClose={handleCloseModal}
        title="Novo Item"
        size="md"
      >
        {submitError && (
          <Alert variant="danger" title="Erro ao criar item" className="mb-4">
            {submitError}
          </Alert>
        )}
        <StockItemForm
          item={null}
          onSubmit={handleCreateSubmit as (data: TablesInsert<'stock_items'> | TablesUpdate<'stock_items'>) => Promise<void>}
          onCancel={handleCloseModal}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={modalMode === 'edit'}
        onClose={handleCloseModal}
        title="Editar Item"
        size="md"
      >
        {submitError && (
          <Alert variant="danger" title="Erro ao editar item" className="mb-4">
            {submitError}
          </Alert>
        )}
        {selectedItem && (
          <StockItemForm
            item={selectedItem}
            onSubmit={handleEditSubmit as (data: TablesInsert<'stock_items'> | TablesUpdate<'stock_items'>) => Promise<void>}
            onCancel={handleCloseModal}
            isSubmitting={isSubmitting}
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={modalMode === 'delete'}
        onClose={handleCloseModal}
        title="Desativar Item"
        size="sm"
      >
        {submitError && (
          <Alert
            variant="danger"
            title="Erro ao desativar item"
            className="mb-4"
          >
            {submitError}
          </Alert>
        )}
        <p className="text-gray-300">
          Tem certeza que deseja desativar o item{' '}
          <span className="font-semibold text-white">
            {selectedItem?.name}
          </span>
          ? O item será marcado como inativo e não aparecerá nas listagens
          padrão.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={handleCloseModal}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={isSubmitting}
          >
            Desativar
          </Button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={modalMode === 'detail'}
        onClose={handleCloseModal}
        title="Detalhes do Item"
        size="xl"
      >
    {selectedItem && (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4 rounded-xl border border-gray-700/50 bg-gray-900/50 p-4 shadow-sm shadow-orange-500/5">
        <ItemIcon iconKey={selectedItem.svg_icon_key} size={56} />
        <div>
          <p className="text-lg font-semibold text-white">{selectedItem.name}</p>
          <p className="text-sm font-mono text-orange-400">{selectedItem.code}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Código
                </p>
                <p className="mt-1 text-sm font-mono text-orange-400">
                  {selectedItem.code}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Nome
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedItem.name}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Categoria
                </p>
                <p className="mt-1">
                  <Badge
                    variant={categoryBadgeVariant(selectedItem.category)}
                    size="sm"
                  >
                    {selectedItem.category ?? '—'}
                  </Badge>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Unidade
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {selectedItem.unit}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  CA/NR
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {selectedItem.ca_nr ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Quantidade Atual
                </p>
                <p
                  className={cn(
                    'mt-1 text-sm font-semibold',
                    quantityColor(
                      selectedItem.current_quantity,
                      selectedItem.minimum_quantity
                    )
                  )}
                >
                  {formatQuantity(selectedItem.current_quantity, selectedItem.unit)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Quantidade Mínima
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {formatQuantity(selectedItem.minimum_quantity, selectedItem.unit)}
                </p>
              </div>
              {selectedItem.description && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium uppercase text-gray-500">
                    Descrição
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    {selectedItem.description}
                  </p>
                </div>
              )}
              {selectedItem.is_active === false && (
                <div>
                  <p className="text-xs font-medium uppercase text-gray-500">
                    Status
                  </p>
                  <p className="mt-1 text-sm text-red-400">
                    Inativo
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Cadastrado em
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {formatDateTime(selectedItem.created_at)}
                </p>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex justify-center py-6">
                <Spinner size="md" />
              </div>
            ) : (
              <>
                {/* Lots Section */}
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-white">
                    Lotes ({itemLots.length})
                  </h4>
                  {itemLots.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Nenhum lote cadastrado para este item
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-gray-700">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-800">
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Código
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Quantidade
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Validade
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemLots.map((lot) => (
                            <tr
                              key={lot.id}
                              className="border-t border-gray-800"
                            >
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {lot.lot_code}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {lot.quantity}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {lot.expiry_date
                                  ? formatDateTime(lot.expiry_date)
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Withdrawal History Section */}
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-white">
                    Histórico de Retiradas ({itemWithdrawals.length})
                  </h4>
                  {itemWithdrawals.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Nenhuma retirada registrada para este item
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-gray-700">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-800">
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Código
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Solicitante
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Qtd
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Data
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemWithdrawals.map((w) => (
                            <tr
                              key={w.id}
                              className="border-t border-gray-800"
                            >
                              <td className="px-3 py-2 text-sm text-white">
                                {w.code ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {w.requested_by_person?.full_name ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {w.quantity}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {formatDateTime(w.created_at)}
                              </td>
                              <td className="px-3 py-2 text-sm">
                                <Badge
                                  variant={
                                    w.status === 'approved' ||
                                    w.status === 'completed'
                                      ? 'success'
                                      : w.status === 'pending'
                                        ? 'warning'
                                        : 'danger'
                                  }
                                  size="sm"
                                >
                                  {w.status === 'approved'
                                    ? 'Aprovada'
                                    : w.status === 'completed'
                                      ? 'Concluída'
                                      : w.status === 'pending'
                                        ? 'Pendente'
                                        : w.status === 'rejected'
                                          ? 'Rejeitada'
                                          : w.status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-gray-700 pt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  if (selectedItem) {
                    handleOpenEdit(selectedItem)
                  }
                }}
              >
                Editar
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (selectedItem) {
                    handleOpenDelete(selectedItem)
                  }
                }}
              >
                Desativar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
