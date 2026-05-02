import { useEffect, useState, useCallback } from 'react'
import type { TablesInsert } from '../../types/database'
import type { KitWithItems } from '../../types'
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
  EmptyState,
  Spinner,
} from '../../components/ui'
import { KitIcon, PackageIcon } from '../../components/icons'
import { KitForm, type KitFormItem } from './KitForm'


type KitItemInsert = TablesInsert<'kit_items'>

type ModalMode = 'create' | 'edit' | 'deactivate' | 'detail' | null

const kitsPageCache: {
  kits: KitWithItems[]
} = {
  kits: [],
}

export function KitsPage({
  embedded = false,
  initialQuery = '',
}: {
  embedded?: boolean
  initialQuery?: string
}) {
  useAuth()

  const [kits, setKits] = useState<KitWithItems[]>(kitsPageCache.kits)
  const [loading, setLoading] = useState(kitsPageCache.kits.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState(initialQuery)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [selectedKit, setSelectedKit] = useState<KitWithItems | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const fetchKits = useCallback(async () => {
    const shouldShowFullLoading = kits.length === 0
    if (shouldShowFullLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('kits')
      .select('*, kit_items(*, stock_items(*))')
      .order('name', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const nextKits = (data as KitWithItems[]) ?? []
    kitsPageCache.kits = nextKits
    setKits(nextKits)
    setLoading(false)
    setRefreshing(false)
  }, [kits.length])

  useEffect(() => {
    void fetchKits()
  }, [fetchKits])

  useEffect(() => {
    setSearchQuery(initialQuery)
  }, [initialQuery])

  const filteredKits = kits.filter((kit) => {
    if (searchQuery === '') return true
    return kit.name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const handleOpenCreate = () => {
    setSelectedKit(null)
    setSubmitError(null)
    setModalMode('create')
  }

  const handleOpenEdit = (kit: KitWithItems) => {
    setSelectedKit(kit)
    setSubmitError(null)
    setModalMode('edit')
  }

  const handleOpenDeactivate = (kit: KitWithItems) => {
    setSelectedKit(kit)
    setSubmitError(null)
    setModalMode('deactivate')
  }

  const handleOpenDetail = (kit: KitWithItems) => {
    setSelectedKit(kit)
    setSubmitError(null)
    setModalMode('detail')
  }

  const handleCloseModal = () => {
    setModalMode(null)
    setSelectedKit(null)
    setSubmitError(null)
  }

  const handleCreateSubmit = async (data: {
    name: string
    description: string | null
    items: KitFormItem[]
  }) => {
    setIsSubmitting(true)
    setSubmitError(null)

    const { data: newKit, error: insertError } = await supabase
      .from('kits')
      .insert({
        name: data.name,
        description: data.description,
      })
      .select()
      .single<{ id: string }>()

    if (insertError) {
      setSubmitError(insertError.message)
      setIsSubmitting(false)
      return
    }

    if (data.items.length > 0 && newKit) {
      const kitItems: KitItemInsert[] = data.items.map((item) => ({
        kit_id: newKit.id,
        stock_item_id: item.stockItem.id,
        quantity: item.quantity,
      }))

      const { error: itemsInsertError } = await supabase
        .from('kit_items')
        .insert(kitItems)

      if (itemsInsertError) {
        setSubmitError(
          `Kit criado, mas erro ao adicionar itens: ${itemsInsertError.message}`
        )
        setIsSubmitting(false)
        handleCloseModal()
        fetchKits()
        return
      }
    }

    setIsSubmitting(false)
    handleCloseModal()
    fetchKits()
  }

  const handleEditSubmit = async (data: {
    name: string
    description: string | null
    items: KitFormItem[]
  }) => {
    if (!selectedKit) return

    setIsSubmitting(true)
    setSubmitError(null)

    const { error: updateError } = await supabase
      .from('kits')
      .update({
        name: data.name,
        description: data.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedKit.id)

    if (updateError) {
      setSubmitError(updateError.message)
      setIsSubmitting(false)
      return
    }

    const { error: deleteItemsError } = await supabase
      .from('kit_items')
      .delete()
      .eq('kit_id', selectedKit.id)

    if (deleteItemsError) {
      setSubmitError(
        `Kit atualizado, mas erro ao remover itens antigos: ${deleteItemsError.message}`
      )
      setIsSubmitting(false)
      handleCloseModal()
      fetchKits()
      return
    }

    if (data.items.length > 0) {
      const kitItems: KitItemInsert[] = data.items.map((item) => ({
        kit_id: selectedKit.id,
        stock_item_id: item.stockItem.id,
        quantity: item.quantity,
      }))

      const { error: itemsInsertError } = await supabase
        .from('kit_items')
        .insert(kitItems)

      if (itemsInsertError) {
        setSubmitError(
          `Kit atualizado, mas erro ao adicionar itens: ${itemsInsertError.message}`
        )
        setIsSubmitting(false)
        handleCloseModal()
        fetchKits()
        return
      }
    }

    setIsSubmitting(false)
    handleCloseModal()
    fetchKits()
  }

  const handleDeactivate = async () => {
    if (!selectedKit) return

    setIsSubmitting(true)
    setSubmitError(null)

    const newIsActive = !selectedKit.is_active

    const { error: updateError } = await supabase
      .from('kits')
      .update({
        is_active: newIsActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedKit.id)

    if (updateError) {
      setSubmitError(updateError.message)
      setIsSubmitting(false)
      return
    }

    setIsSubmitting(false)
    handleCloseModal()
    fetchKits()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          {embedded ? (
            <>
              <h3 className="text-xl font-semibold text-white">Kits de Retirada</h3>
              <p className="mt-1 text-sm text-gray-400">
                Monte e ajuste kits no mesmo contexto do estoque
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-white">Kits de Retirada</h2>
              <p className="mt-1 text-sm text-gray-400">
                Gerencie kits de EPIs pré-montados para retiradas rápidas
              </p>
            </>
          )}
        </div>
        <Button onClick={handleOpenCreate} leftIcon={<KitIcon size={16} />}>
          Novo Kit
        </Button>
      </div>

      {error && (
        <Alert variant="danger" title="Erro ao carregar kits">
          {error}
        </Alert>
      )}

      <Card>
        <Input
          placeholder="Buscar kit por nome..."
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
        {refreshing && (
          <div className="mt-3 inline-flex items-center gap-2 text-xs text-orange-200/75">
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
            Atualizando kits...
          </div>
        )}
      </Card>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-gray-400">Carregando kits...</p>
        </div>
      ) : filteredKits.length === 0 && searchQuery === '' ? (
        <EmptyState
          icon={<KitIcon size={48} />}
          title="Nenhum kit cadastrado"
          description="Comece criando o primeiro kit de retirada"
          action={{ label: 'Novo Kit', onClick: handleOpenCreate }}
        />
      ) : filteredKits.length === 0 ? (
        <EmptyState
          icon={<KitIcon size={48} />}
          title="Nenhum kit encontrado"
          description={`Nenhum kit corresponde a "${searchQuery}"`}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredKits.map((kit) => {
            const itemCount = kit.kit_items?.length ?? 0

            return (
              <Card
                key={kit.id}
                variant="bordered"
                padding="none"
              >
                <div
                  className="cursor-pointer p-4 transition-colors hover:bg-gray-800/50"
                  onClick={() => handleOpenDetail(kit)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-orange-500/20">
                        <KitIcon size={20} className="text-orange-400" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-white">
                          {kit.name}
                        </h3>
                        {kit.description && (
                          <p className="mt-0.5 truncate text-sm text-gray-400">
                            {kit.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <Badge
                        variant={kit.is_active ? 'success' : 'danger'}
                        size="sm"
                        dot
                      >
                        {kit.is_active ? 'Ativo' : 'Inativo'}
                      </Badge>
                      <Badge variant="primary" size="sm">
                        {itemCount} {itemCount === 1 ? 'item' : 'itens'}
                      </Badge>
                    </div>
                  </div>

                  {itemCount > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5">
                      {kit.kit_items.map((ki) => (
                        <div
                          key={ki.id}
                          className="flex items-center justify-between rounded-lg bg-gray-800/50 px-3 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <PackageIcon
                              size={14}
                              className="text-gray-500"
                            />
                            <span className="text-sm text-gray-300">
                              {ki.stock_items?.name ?? 'Item'}
                            </span>
                            {ki.stock_items?.category && (
                              <Badge variant="default" size="sm">
                                {ki.stock_items.category}
                              </Badge>
                            )}
                          </div>
                          <span className="text-sm font-medium text-gray-400">
                            {ki.quantity} {ki.stock_items?.unit ?? 'un'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 border-t border-gray-700 px-4 py-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenEdit(kit)
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant={kit.is_active ? 'danger' : 'primary'}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenDeactivate(kit)
                    }}
                  >
                    {kit.is_active ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={modalMode === 'create'}
        onClose={handleCloseModal}
        title="Novo Kit"
        size="lg"
      >
        {submitError && (
          <Alert variant="danger" title="Erro ao criar kit" className="mb-4">
            {submitError}
          </Alert>
        )}
        <KitForm
          kit={null}
          onSubmit={handleCreateSubmit}
          onCancel={handleCloseModal}
          isSubmitting={isSubmitting}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={modalMode === 'edit'}
        onClose={handleCloseModal}
        title="Editar Kit"
        size="lg"
      >
        {submitError && (
          <Alert variant="danger" title="Erro ao editar kit" className="mb-4">
            {submitError}
          </Alert>
        )}
        {selectedKit && (
          <KitForm
            kit={selectedKit}
            onSubmit={handleEditSubmit}
            onCancel={handleCloseModal}
            isSubmitting={isSubmitting}
          />
        )}
      </Modal>

      {/* Deactivate/Activate Modal */}
      <Modal
        isOpen={modalMode === 'deactivate'}
        onClose={handleCloseModal}
        title={selectedKit?.is_active ? 'Desativar Kit' : 'Ativar Kit'}
        size="sm"
      >
        {submitError && (
          <Alert
            variant="danger"
            title={selectedKit?.is_active ? 'Erro ao desativar kit' : 'Erro ao ativar kit'}
            className="mb-4"
          >
            {submitError}
          </Alert>
        )}
        <p className="text-gray-300">
          {selectedKit?.is_active ? (
            <>
              Tem certeza que deseja desativar o kit{' '}
              <span className="font-semibold text-white">
                {selectedKit?.name}
              </span>
              ? O kit não aparecerá nas retiradas enquanto estiver inativo.
            </>
          ) : (
            <>
              Tem certeza que deseja ativar o kit{' '}
              <span className="font-semibold text-white">
                {selectedKit?.name}
              </span>
              ?
            </>
          )}
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
            variant={selectedKit?.is_active ? 'danger' : 'primary'}
            onClick={handleDeactivate}
            isLoading={isSubmitting}
          >
            {selectedKit?.is_active ? 'Desativar' : 'Ativar'}
          </Button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={modalMode === 'detail'}
        onClose={handleCloseModal}
        title="Detalhes do Kit"
        size="lg"
      >
        {selectedKit && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Nome
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedKit.name}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Status
                </p>
                <p className="mt-1">
                  <Badge
                    variant={selectedKit.is_active ? 'success' : 'danger'}
                    size="sm"
                    dot
                  >
                    {selectedKit.is_active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </p>
              </div>
              {selectedKit.description && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium uppercase text-gray-500">
                    Descrição
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    {selectedKit.description}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Criado em
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {formatDateTime(selectedKit.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  Atualizado em
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {formatDateTime(selectedKit.updated_at)}
                </p>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-white">
                Itens do Kit ({selectedKit.kit_items?.length ?? 0})
              </h4>
              {(!selectedKit.kit_items || selectedKit.kit_items.length === 0) ? (
                <p className="text-sm text-gray-500">
                  Nenhum item neste kit
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-700">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-800">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                          Item
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                          Categoria
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                          Estoque Atual
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">
                          Qtd no Kit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedKit.kit_items.map((ki) => {
                        const isLowStock =
                          ki.stock_items?.minimum_quantity > 0 &&
                          ki.stock_items.current_quantity <= ki.stock_items.minimum_quantity

                        return (
                          <tr
                            key={ki.id}
                            className="border-t border-gray-800"
                          >
                            <td className="px-3 py-2 text-sm text-white">
                              {ki.stock_items?.name ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-sm">
                              <Badge variant="default" size="sm">
                                {ki.stock_items?.category ?? '—'}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-sm">
                              <span
                                className={cn(
                                  'font-medium',
                                  isLowStock
                                    ? 'text-red-400'
                                    : 'text-gray-300'
                                )}
                              >
                                {ki.stock_items
                                  ? formatQuantity(
                                      ki.stock_items.current_quantity,
                                      ki.stock_items.unit
                                    )
                                  : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-sm font-medium text-orange-400">
                              {ki.quantity} {ki.stock_items?.unit ?? 'un'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-700 pt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  if (selectedKit) handleOpenEdit(selectedKit)
                }}
              >
                Editar
              </Button>
              <Button
                variant={selectedKit.is_active ? 'danger' : 'primary'}
                onClick={() => {
                  if (selectedKit) handleOpenDeactivate(selectedKit)
                }}
              >
                {selectedKit.is_active ? 'Desativar' : 'Ativar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
