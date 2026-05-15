import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { cn, formatDateTime, formatQuantity } from '../../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  Modal,
  Spinner,
} from '../../components/ui'
import { PackageIcon } from '../../components/icons'
import { ItemVisual } from '../../components/items/ItemVisual'
import { StockItemForm } from './StockItemForm'
import { StockImportModal } from './StockImportModal'
import { KitsPage } from '../kits/KitsPage'
import { StockReturnsTab } from './StockReturnsTab'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

type StockItemRow = Tables<'stock_items'>

interface StockItemWithLowStock extends StockItemRow {
  is_low_stock: boolean
}

interface MovementWithDetails {
  id: string
  code: string | null
  type: 'withdrawal' | 'return'
  status: string
  created_at: string
  requested_by_person: { full_name: string } | null
  quantity: number
}

type WithdrawalMovementEntry = {
  quantity: number
  withdrawal: {
    id: string
    code: string | null
    status: string
    created_at: string
    requested_by: string | null
  }
}

type ReturnMovementEntry = {
  id: string
  quantity: number
  status: string
  created_at: string
  source_person_id: string | null
}

type ModalMode = 'detail' | 'create' | 'edit' | 'delete' | 'import'
type StockRowRecord = StockItemWithLowStock & Record<string, unknown>

const CATEGORY_FILTER_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'EPI', label: 'EPI' },
  { value: 'Vestuario', label: 'Vestuario' },
  { value: 'Ferramenta', label: 'Ferramenta' },
  { value: 'Material', label: 'Material' },
  { value: 'Outro', label: 'Outro' },
]

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
]

const stockPageCache: {
  items: StockItemWithLowStock[]
  totalCount: number
} = {
  items: [],
  totalCount: 0,
}

function ItemIcon({ iconKey, size = 28 }: { iconKey: string | null; size?: number }) {
  return <ItemVisual iconKey={iconKey} size={size} />
}

function stockItemDisplayName(item: Pick<StockItemRow, 'name'>): string {
  return item.name
}

interface UpdateStockItemRpcArgs {
  p_stock_item_id: string
  p_name: string
  p_description: string | null
  p_category: string | null
  p_unit: string
  p_ca_nr: string | null
  p_minimum_quantity: number
  p_svg_icon_key: string | null
  p_stock_adjustment: number
  p_quantity_new?: number | null
  p_quantity_used?: number | null
  p_quantity_damaged?: number | null
  p_adjustment_bucket?: 'new' | 'used' | 'damaged'
}

function isRpcOverloadAmbiguity(message: string | undefined): boolean {
  if (!message) return false
  return message.includes('Could not choose the best candidate function between')
    && message.includes('update_stock_item_details_and_quantity')
}

async function updateStockItemWithFallback(args: UpdateStockItemRpcArgs) {
  const primaryResult = await supabase.rpc('update_stock_item_details_and_quantity', args)
  if (!isRpcOverloadAmbiguity(primaryResult.error?.message)) {
    return primaryResult
  }

  return (supabase as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('update_stock_item_details_and_quantity', {
    ...args,
    p_variant_group: null,
    p_variant_label: null,
  })
}

export function StockPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile } = useAuth()
  const currentTab = searchParams.get('tab')
  const activeTab = currentTab === 'kits' || currentTab === 'returns' ? currentTab : 'items'
  const initialQuery = searchParams.get('q') ?? ''

  const [items, setItems] = useState<StockItemWithLowStock[]>(stockPageCache.items)
  const [loading, setLoading] = useState(stockPageCache.items.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState(initialQuery)
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 220)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')

  const [currentPage, setCurrentPage] = useState(0)
  const [totalCount, setTotalCount] = useState(stockPageCache.totalCount)
  const PAGE_SIZE = 50

  const [modalMode, setModalMode] = useState<ModalMode | null>(null)
  const [selectedItem, setSelectedItem] = useState<StockItemRow | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [itemWithdrawals, setItemWithdrawals] = useState<MovementWithDetails[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchItems = useCallback(async (page = 0) => {
    const shouldShowFullLoading = stockPageCache.items.length === 0
    if (shouldShowFullLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    try {
      let query = supabase
        .from('stock_items')
        .select(
          'id, code, name, category, ca_nr, current_quantity, quantity_new, quantity_used, quantity_damaged, minimum_quantity, unit, is_active, svg_icon_key, description, created_at, updated_at',
          { count: 'exact' }
        )
        .order('name', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (statusFilter === 'active') {
        query = query.eq('is_active', true)
      } else if (statusFilter === 'inactive') {
        query = query.eq('is_active', false)
      }

      if (categoryFilter) {
        query = query.eq('category', categoryFilter)
      }

      if (debouncedSearchQuery.trim()) {
        const searchTerm = debouncedSearchQuery.trim()
        query = query.or(`name.ilike.%${searchTerm}%,code.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%,ca_nr.ilike.%${searchTerm}%`)
      }

      const { data, error: fetchError, count } = await query
      if (fetchError) {
        setError(fetchError.message)
        return
      }

      const mapped = ((data as StockItemRow[]) ?? []).map((item) => ({
        ...item,
        is_low_stock: item.minimum_quantity > 0 && item.current_quantity <= item.minimum_quantity,
      }))

      stockPageCache.items = mapped
      stockPageCache.totalCount = count || 0
      setItems(mapped)
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error fetching items:', err)
      setError('Erro ao carregar itens.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [categoryFilter, debouncedSearchQuery, statusFilter])

  useEffect(() => {
    setCurrentPage(0)
    void fetchItems(0)
  }, [fetchItems])

  useEffect(() => {
    const nextQuery = searchParams.get('q') ?? ''
    if (nextQuery !== searchQuery) {
      setSearchQuery(nextQuery)
    }
  }, [searchParams, searchQuery])

  const fetchItemDetails = useCallback(async (itemId: string) => {
    setDetailLoading(true)
    try {
      const [withdrawalsRes, returnsRes] = await Promise.all([
        supabase
          .from('withdrawal_items')
          .select(`
            quantity,
            withdrawal:withdrawals(
              id,
              code,
              status,
              created_at,
              requested_by
            )
          `)
          .eq('stock_item_id', itemId)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('stock_return_requests')
          .select('id, quantity, status, created_at, source_person_id')
          .eq('stock_item_id', itemId)
          .order('created_at', { ascending: false })
          .limit(10)
      ])

      const rawWiData = (withdrawalsRes.data as (WithdrawalMovementEntry | { quantity: number; withdrawal: null })[]) ?? []

      const rawRetData = (returnsRes.data as ReturnMovementEntry[]) ?? []

      const requestedByIds = [
        ...rawWiData.map((entry) => entry.withdrawal?.requested_by),
        ...rawRetData.map((entry) => entry.source_person_id)
      ].filter((value): value is string => Boolean(value))

      let peopleMap: Record<string, { full_name: string }> = {}
      if (requestedByIds.length > 0) {
        const { data: peopleData } = await supabase
          .from('people')
          .select('id, full_name')
          .in('id', Array.from(new Set(requestedByIds)))

        peopleMap = Object.fromEntries(
          (peopleData ?? []).map((person) => [person.id, { full_name: person.full_name }])
        )
      }

      const withdrawalMovements: MovementWithDetails[] = rawWiData
        .filter((entry): entry is WithdrawalMovementEntry => Boolean(entry.withdrawal))
        .map((entry) => ({
          id: entry.withdrawal.id,
          code: entry.withdrawal.code,
          type: 'withdrawal' as const,
          status: entry.withdrawal.status,
          created_at: entry.withdrawal.created_at,
          requested_by_person: entry.withdrawal.requested_by
            ? peopleMap[entry.withdrawal.requested_by] ?? null
            : null,
          quantity: entry.quantity,
        }))

      const returnMovements: MovementWithDetails[] = rawRetData.map((entry) => ({
          id: entry.id,
          code: null,
          type: 'return' as const,
          status: entry.status,
          created_at: entry.created_at,
          requested_by_person: entry.source_person_id
            ? peopleMap[entry.source_person_id] ?? null
            : null,
          quantity: entry.quantity,
        }))

      const typedMovements: MovementWithDetails[] = [...withdrawalMovements, ...returnMovements]

      typedMovements.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setItemWithdrawals(typedMovements.slice(0, 10))
    } catch (err) {
      console.error('Error fetching item details:', err)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const lowStockCount = items.filter((item) => item.is_low_stock).length

  const handleCloseModal = () => {
    setModalMode(null)
    setSelectedItem(null)
    setSubmitError(null)
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
      const { error: insertError } = await supabase
        .from('stock_items')
        .insert({
          code: data.code,
          name: data.name,
          description: data.description ?? null,
          category: data.category ?? null,
          unit: data.unit,
          ca_nr: data.ca_nr ?? null,
          svg_icon_key: data.svg_icon_key ?? null,
          current_quantity: data.current_quantity ?? 0,
          quantity_new: data.quantity_new ?? 0,
          quantity_used: data.quantity_used ?? 0,
          quantity_damaged: data.quantity_damaged ?? 0,
          minimum_quantity: data.minimum_quantity ?? 0,
          created_by: profile.id,
        })

      if (insertError) {
        setSubmitError(insertError.message)
        return
      }

      handleCloseModal()
      void fetchItems(currentPage)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado ao criar item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditSubmit = async (data: TablesUpdate<'stock_items'> & { stock_adjustment?: number }) => {
    if (!selectedItem) return

    const updatesComposition = data.quantity_new !== undefined
      || data.quantity_used !== undefined
      || data.quantity_damaged !== undefined

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const { error: updateError } = await updateStockItemWithFallback({
        p_stock_item_id: selectedItem.id,
        p_name: data.name ?? selectedItem.name,
        p_description: data.description ?? null,
        p_category: data.category ?? null,
        p_unit: data.unit ?? selectedItem.unit,
        p_ca_nr: data.ca_nr ?? null,
        p_minimum_quantity: data.minimum_quantity ?? selectedItem.minimum_quantity,
        p_svg_icon_key: data.svg_icon_key ?? null,
        p_stock_adjustment: data.stock_adjustment ?? 0,
        p_quantity_new: updatesComposition ? data.quantity_new ?? 0 : null,
        p_quantity_used: updatesComposition ? data.quantity_used ?? 0 : null,
        p_quantity_damaged: updatesComposition ? data.quantity_damaged ?? 0 : null,
        p_adjustment_bucket: (data as TablesUpdate<'stock_items'> & { adjustment_bucket?: 'new' | 'used' | 'damaged' }).adjustment_bucket ?? 'new',
      })

      if (updateError) {
        setSubmitError(updateError.message)
        return
      }

      handleCloseModal()
      void fetchItems(currentPage)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado ao editar item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeactivate = async () => {
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
      void fetchItems(currentPage)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado ao desativar item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePermanentDelete = async () => {
    if (!selectedItem) return

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const { error: deleteError } = await supabase
        .from('stock_items')
        .delete()
        .eq('id', selectedItem.id)

      if (deleteError) {
        if (deleteError.message.toLowerCase().includes('violates foreign key constraint')) {
          setSubmitError('Este item possui historico vinculado. Use "Desativar" para preservar retiradas e movimentacoes.')
          return
        }

        setSubmitError(deleteError.message)
        return
      }

      handleCloseModal()
      void fetchItems(currentPage)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado ao excluir item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const quantityColor = (current: number, minimum: number) => {
    if (minimum <= 0 || current > minimum) return 'text-emerald-400'
    if (current === minimum) return 'text-orange-400'
    return 'text-red-400'
  }

  const categoryBadgeVariant = (category: string | null): 'primary' | 'info' | 'success' | 'default' => {
    switch (category) {
      case 'EPI':
        return 'primary'
      case 'Vestuario':
        return 'info'
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
          <span className="font-medium text-white">
            {stockItemDisplayName(row as unknown as StockItemRow)}
          </span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoria',
      render: (_value: unknown, row: StockRowRecord) => (
        <Badge variant={categoryBadgeVariant(row.category)} size="sm">
          {row.category ?? '-'}
        </Badge>
      ),
    },
    {
      key: 'ca_nr',
      header: 'CA/NR',
      render: (_value: unknown, row: StockRowRecord) => (
        <span className="text-gray-300">{row.ca_nr ?? '-'}</span>
      ),
    },
    {
      key: 'current_quantity',
      header: 'Qtd Atual',
      sortable: true,
      render: (_value: unknown, row: StockRowRecord) => (
        <div className="flex flex-col gap-1">
          <span className={cn('font-semibold', quantityColor(row.current_quantity, row.minimum_quantity))}>
            {formatQuantity(row.current_quantity, row.unit)}
          </span>
          <div className="flex flex-wrap gap-1">
            {(row.quantity_new as number) > 0 ? (
              <Badge variant="success" size="sm">Novo {(row.quantity_new as number)}</Badge>
            ) : null}
            {(row.quantity_used as number) > 0 ? (
              <Badge variant="info" size="sm">Usado {(row.quantity_used as number)}</Badge>
            ) : null}
            {(row.quantity_damaged as number) > 0 ? (
              <Badge variant="danger" size="sm">Avaria {(row.quantity_damaged as number)}</Badge>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'minimum_quantity',
      header: 'Qtd Mínima',
      render: (_value: unknown, row: StockRowRecord) => (
        <span className="text-gray-400">{formatQuantity(row.minimum_quantity, row.unit)}</span>
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
      <div className="flex gap-2 border-b border-white/8 pb-2">
        <button
          type="button"
          onClick={() => setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('tab', 'items')
            return next
          })}
          className={cn(
            'rounded-2xl px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'items' ? 'bg-orange-500/14 text-orange-200' : 'text-gray-400 hover:bg-white/5 hover:text-white'
          )}
        >
          Itens
        </button>
        <button
          type="button"
          onClick={() => setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('tab', 'kits')
            return next
          })}
          className={cn(
            'rounded-2xl px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'kits' ? 'bg-orange-500/14 text-orange-200' : 'text-gray-400 hover:bg-white/5 hover:text-white'
          )}
        >
          Kits
        </button>
        <button
          type="button"
          onClick={() => setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('tab', 'returns')
            return next
          })}
          className={cn(
            'rounded-2xl px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'returns' ? 'bg-orange-500/14 text-orange-200' : 'text-gray-400 hover:bg-white/5 hover:text-white'
          )}
        >
          Itens devolvidos
        </button>
      </div>

      {activeTab === 'kits' ? (
        <KitsPage embedded initialQuery={initialQuery} />
      ) : activeTab === 'returns' ? (
        <StockReturnsTab embedded profileId={profile?.id ?? null} />
      ) : (
        <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestão de Estoque</h2>
          <p className="mt-1 text-sm text-gray-400">
            Gerencie os itens do almoxarifado e seus níveis de estoque
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedItem(null)
              setSubmitError(null)
              setModalMode('import')
            }}
          >
            Importar documento
          </Button>
          <Button onClick={() => {
            setSelectedItem(null)
            setSubmitError(null)
            setModalMode('create')
          }} leftIcon={<PackageIcon size={16} />}>
            Novo item
          </Button>
        </div>
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
              onChange={(event) => {
                const nextValue = event.target.value
                setSearchQuery(nextValue)
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev)
                  if (nextValue.trim()) {
                    next.set('q', nextValue)
                  } else {
                    next.delete('q')
                  }
                  return next
                })
              }}
              leftIcon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M11 11L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              }
            />
          </div>
          <div className="flex gap-3">
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="w-full appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            >
              {CATEGORY_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {refreshing && (
          <div className="mt-3 inline-flex items-center gap-2 text-xs text-orange-200/75">
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
            Atualizando itens...
          </div>
        )}
      </Card>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-400">Carregando itens...</p>
        </div>
      ) : items.length === 0 && searchQuery === '' && categoryFilter === '' ? (
        <EmptyState
          icon={<PackageIcon size={48} />}
          title="Nenhum item cadastrado"
          description="Comece cadastrando o primeiro item do almoxarifado"
          action={{ label: 'Novo item', onClick: () => setModalMode('create') }}
        />
      ) : (
        <>
          <DataTable<StockRowRecord>
            columns={columns}
            data={items as StockRowRecord[]}
            keyExtractor={(row) => row.id}
            isLoading={false}
            emptyMessage="Nenhum item encontrado com os filtros aplicados"
            onRowClick={(row) => {
              setSelectedItem(row as unknown as StockItemRow)
              setSubmitError(null)
              setModalMode('detail')
              void fetchItemDetails(row.id)
            }}
          />

          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-gray-700 pt-4">
              <p className="text-sm text-gray-400">
                Mostrando {currentPage * PAGE_SIZE + 1} - {Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} de {totalCount} itens
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const nextPage = currentPage - 1
                    setCurrentPage(nextPage)
                    void fetchItems(nextPage)
                  }}
                  disabled={currentPage === 0}
                >
                  Anterior
                </Button>
                <span className="text-sm text-gray-400">
                  Página {currentPage + 1} de {Math.ceil(totalCount / PAGE_SIZE)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const nextPage = currentPage + 1
                    setCurrentPage(nextPage)
                    void fetchItems(nextPage)
                  }}
                  disabled={(currentPage + 1) * PAGE_SIZE >= totalCount}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal isOpen={modalMode === 'create'} onClose={handleCloseModal} title="Novo Item" size="md">
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

      <Modal isOpen={modalMode === 'import'} onClose={handleCloseModal} title="Importar documento PDF" size="xl">
        <StockImportModal
          onClose={handleCloseModal}
          onImported={() => {
            handleCloseModal()
            void fetchItems(currentPage)
          }}
        />
      </Modal>

      <Modal isOpen={modalMode === 'edit'} onClose={handleCloseModal} title="Editar Item" size="md">
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

      <Modal isOpen={modalMode === 'delete'} onClose={handleCloseModal} title="Desativar ou Excluir Item" size="sm">
        {submitError && (
          <Alert variant="danger" title="Erro ao alterar item" className="mb-4">
            {submitError}
          </Alert>
        )}
        <p className="text-gray-300">
          Escolha o que fazer com <span className="font-semibold text-white">{selectedItem?.name}</span>.
        </p>
        <div className="mt-4 rounded-xl border border-white/8 bg-white/4 p-4">
          <p className="text-sm font-medium text-white">Desativar</p>
          <p className="mt-1 text-sm text-gray-400">
            Mantem o historico e retira o item do uso normal no estoque.
          </p>
          <Button className="mt-4" variant="secondary" onClick={handleDeactivate} isLoading={isSubmitting}>
            Desativar item
          </Button>
        </div>
        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm font-medium text-white">Excluir</p>
          <p className="mt-1 text-sm text-gray-400">
            Remove o item de vez. Se houver retiradas ou historico vinculado, a exclusao sera bloqueada.
          </p>
          <Button className="mt-4" variant="danger" onClick={handlePermanentDelete} isLoading={isSubmitting}>
            Excluir item
          </Button>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={handleCloseModal} disabled={isSubmitting}>
            Fechar
          </Button>
        </div>
      </Modal>

      <Modal isOpen={modalMode === 'detail'} onClose={handleCloseModal} title="Detalhes do Item" size="xl">
        {selectedItem && (
          <div className="flex flex-col gap-6">
            <div className="rounded-[26px] border border-white/8 bg-[#111215] p-5">
              <div className="mx-auto flex max-w-3xl items-center gap-4 rounded-[22px] border border-white/8 bg-white/4 p-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-orange-400/15 bg-orange-500/10">
                  <ItemIcon iconKey={selectedItem.svg_icon_key} size={58} />
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">{stockItemDisplayName(selectedItem)}</p>
                  <p className="text-sm font-mono text-orange-400">{selectedItem.code}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="rounded-2xl border border-white/8 bg-[#111215] p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailField label="Código" value={<span className="font-mono text-orange-400">{selectedItem.code}</span>} />
                  <DetailField label="Nome" value={selectedItem.name} />
                  <DetailField
                    label="Categoria"
                    value={<Badge variant={categoryBadgeVariant(selectedItem.category)} size="sm">{selectedItem.category ?? '-'}</Badge>}
                  />
                  <DetailField label="Unidade" value={selectedItem.unit} />
                  <DetailField label="CA/NR" value={selectedItem.ca_nr ?? '-'} />
                  <DetailField
                    label="Quantidade Atual"
                    value={
                      <span className={cn('font-semibold', quantityColor(selectedItem.current_quantity, selectedItem.minimum_quantity))}>
                        {formatQuantity(selectedItem.current_quantity, selectedItem.unit)}
                      </span>
                    }
                  />
                  <DetailField
                    label="Quantidade Mínima"
                    value={formatQuantity(selectedItem.minimum_quantity, selectedItem.unit)}
                  />
                  <DetailField label="Cadastrado em" value={formatDateTime(selectedItem.created_at)} />
                  {selectedItem.description && (
                    <div className="sm:col-span-2">
                      <DetailField label="Descrição" value={selectedItem.description} />
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-[#111215] p-5">
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Histórico de movimentações
                </h4>

                {detailLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Spinner size="md" />
                  </div>
                ) : itemWithdrawals.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhuma movimentação registrada para este item</p>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-white/8">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-white/5">
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Código / Tipo</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Pessoa / Solicitante</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Qtd</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemWithdrawals.map((withdrawal) => (
                          <tr key={withdrawal.id} className="border-t border-white/8">
                            <td className="px-3 py-2 text-sm text-white">
                              {withdrawal.type === 'return' ? (
                                <Badge variant="success" size="sm">Devolução</Badge>
                              ) : (
                                withdrawal.code ?? '-'
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-300">{withdrawal.requested_by_person?.full_name ?? '-'}</td>
                            <td className="px-3 py-2 text-sm text-gray-300">{withdrawal.quantity}</td>
                            <td className="px-3 py-2 text-sm">
                              <Badge
                                variant={
                                  withdrawal.status === 'approved' || withdrawal.status === 'completed'
                                    ? 'success'
                                    : withdrawal.status === 'pending'
                                      ? 'warning'
                                      : 'danger'
                                }
                                size="sm"
                              >
                                {withdrawal.status === 'approved'
                                  ? 'Aprovada'
                                  : withdrawal.status === 'completed'
                                    ? 'Concluída'
                                    : withdrawal.status === 'pending'
                                      ? 'Pendente'
                                      : withdrawal.status === 'rejected'
                                        ? 'Rejeitada'
                                        : withdrawal.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/8 pt-4">
              <Button variant="secondary" onClick={() => setModalMode('edit')}>
                Editar
              </Button>
              <Button variant="danger" onClick={() => setModalMode('delete')}>
                Desativar ou excluir
              </Button>
            </div>
          </div>
        )}
      </Modal>
        </>
      )}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <div className="text-sm text-gray-200">{value}</div>
    </div>
  )
}

