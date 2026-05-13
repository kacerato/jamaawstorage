import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Tables, AppRole } from '../../types/database'
import { supabase } from '../../lib/supabase'

import { useAuth } from '../../hooks/useAuth'
import { Button, Input, Select, Badge, DataTable, Modal, Alert } from '../../components/ui'
import { UsersIcon, UserIcon, HelmetIcon } from '../../components/icons'
import { PersonForm } from './PersonForm'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

type PersonWithInventoryCount = Tables<'people'> & {
  inventory_count: number
  low_stock_warnings: number
}

type RoleFilter = 'all' | 'leader' | 'collaborator'
type StatusFilter = 'active' | 'inactive'

function getJobTitleLabel(jobTitle: string | null): string {
  if (!jobTitle) return '—'
  if (jobTitle === 'cabista') return 'Cabista'
  if (jobTitle === 'ajudante de cabista') return 'Ajudante de cabista'
  return jobTitle
}

const peoplePageCache: {
  people: PersonWithInventoryCount[]
  totalCount: number
} = {
  people: [],
  totalCount: 0,
}

export function PeoplePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile } = useAuth()
  const initialQuery = searchParams.get('q') ?? ''

  const [people, setPeople] = useState<PersonWithInventoryCount[]>(peoplePageCache.people)
  const [loading, setLoading] = useState(peoplePageCache.people.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState(initialQuery)
  const debouncedSearch = useDebouncedValue(search, 220)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  const [showFormModal, setShowFormModal] = useState(false)
  const [editingPerson, setEditingPerson] = useState<Tables<'people'> | null>(null)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)

  // Paginação
  const [currentPage, setCurrentPage] = useState(0)
  const [totalCount, setTotalCount] = useState(peoplePageCache.totalCount)
  const PAGE_SIZE = 50

  // OTIMIZADO: Paginação server-side com query simplificada
  const fetchPeople = useCallback(async (page = 0) => {
    const shouldShowFullLoading = people.length === 0
    if (shouldShowFullLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setError(null)

    try {
      // Query simplificada - sem join complexo com inventories
      let query = supabase
        .from('people')
        .select('id, full_name, employee_id, profile_id, role, job_title, sector, cpf, photo_url, document_attachments, is_active, created_at, updated_at', { count: 'exact' })
        .neq('role', 'supervisor')
        .order('full_name')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      // Filtro de status no servidor
      if (statusFilter === 'active') {
        query = query.eq('is_active', true)
      } else if (statusFilter === 'inactive') {
        query = query.eq('is_active', false)
      }

      // Filtro de role no servidor
      if (roleFilter !== 'all') {
        query = query.eq('role', roleFilter)
      }

      // Busca por texto no servidor
      if (debouncedSearch.trim()) {
        const searchTerm = debouncedSearch.trim()
        query = query.or(`full_name.ilike.%${searchTerm}%,employee_id.ilike.%${searchTerm}%`)
      }

      const { data, error: fetchError, count } = await query

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      if (!data) {
        setPeople([])
        setTotalCount(0)
        setLoading(false)
        return
      }

      // Buscar contagem de inventários separadamente (mais eficiente)
      const personIds = data.map(p => p.id)
      let inventoryMap: Record<string, { count: number; low_stock: number }> = {}

      if (personIds.length > 0) {
        const { data: invData } = await supabase
          .from('person_inventories')
          .select('person_id, stock_items!inner(minimum_quantity, current_quantity)')
          .in('person_id', personIds)

        if (invData) {
          for (const inv of invData as any[]) {
            const personId = inv.person_id
            if (!inventoryMap[personId]) {
              inventoryMap[personId] = { count: 0, low_stock: 0 }
            }
            inventoryMap[personId].count++
            const stockItem = inv.stock_items
            if (stockItem && stockItem.current_quantity <= stockItem.minimum_quantity) {
              inventoryMap[personId].low_stock++
            }
          }
        }
      }

      const enriched: PersonWithInventoryCount[] = (data as unknown as RawPersonRow[]).map(
        (row) => ({
          id: row.id,
          full_name: row.full_name,
          employee_id: row.employee_id,
          profile_id: row.profile_id,
          role: row.role,
          job_title: row.job_title,
          sector: row.sector,
          cpf: row.cpf,
          photo_url: row.photo_url,
          document_attachments: row.document_attachments ?? [],
          is_active: row.is_active,
          created_at: row.created_at,
          updated_at: row.updated_at,
          inventory_count: inventoryMap[row.id]?.count ?? 0,
          low_stock_warnings: inventoryMap[row.id]?.low_stock ?? 0,
        }),
      )

      peoplePageCache.people = enriched
      peoplePageCache.totalCount = count || 0
      setPeople(enriched)
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error fetching people:', err)
      setError('Erro ao carregar colaboradores.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter, roleFilter, debouncedSearch, people.length])

  useEffect(() => {
    setCurrentPage(0)
    void fetchPeople(0)
  }, [fetchPeople])

  useEffect(() => {
    const nextQuery = searchParams.get('q') ?? ''
    if (nextQuery !== search) {
      setSearch(nextQuery)
    }
  }, [searchParams, search])

  // Não precisa mais de filteredPeople - filtros são no servidor
  const filteredPeople = people

  const handleToggleActive = async (person: PersonWithInventoryCount) => {
    setDeactivatingId(person.id)

    const { error: updateError } = await supabase
      .from('people')
      .update({ is_active: !person.is_active, updated_at: new Date().toISOString() })
      .eq('id', person.id)

    if (updateError) {
      setError(updateError.message)
      setDeactivatingId(null)
      return
    }

    setPeople((prev) =>
      prev.map((p) =>
        p.id === person.id ? { ...p, is_active: !p.is_active } : p,
      ),
    )
    setDeactivatingId(null)
  }

  const handleFormSubmit = (_result: Tables<'people'>) => {
    setShowFormModal(false)
    setEditingPerson(null)
    void fetchPeople()
  }

  const handleFormCancel = () => {
    setShowFormModal(false)
    setEditingPerson(null)
  }

  const columns = [
    {
      key: 'full_name',
      header: 'Nome',
      sortable: true,
      render: (_value: unknown, row: PersonWithInventoryCount) => (
        <div className="flex items-center gap-3">
          {row.photo_url ? (
            <img
              src={row.photo_url}
              alt={row.full_name}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-xs font-medium text-gray-300">
              {row.full_name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
          )}
          <span className="font-medium text-white">{row.full_name}</span>
        </div>
      ),
    },
    {
      key: 'employee_id',
      header: 'Matrícula',
      sortable: true,
      render: (value: unknown) => (value as string | null) ?? '—',
    },
    {
      key: 'role',
      header: 'Cargo',
      sortable: true,
      render: (value: unknown) => {
        const role = value as AppRole
        if (role === 'leader') {
          return (
            <Badge variant="primary" dot>
              <HelmetIcon size={12} className="mr-1 inline-block" />
              Líder
            </Badge>
          )
        }
        return (
          <Badge variant="info" dot>
            <UserIcon size={12} className="mr-1 inline-block" />
            Colaborador
          </Badge>
        )
      },
    },
    {
      key: 'job_title',
      header: 'Função',
      sortable: true,
      render: (_value: unknown, row: PersonWithInventoryCount) =>
        row.role === 'leader' ? '—' : getJobTitleLabel(row.job_title),
    },
    {
      key: 'sector',
      header: 'Setor',
      sortable: true,
      render: (value: unknown) => (value as string | null) ?? '—',
    },
    {
      key: 'is_active',
      header: 'Status',
      sortable: true,
      render: (value: unknown) =>
        value as boolean ? (
          <Badge variant="success" dot>Ativo</Badge>
        ) : (
          <Badge variant="danger" dot>Inativo</Badge>
        ),
    },
    {
      key: 'inventory_count',
      header: 'Inventário',
      render: (value: unknown, row: PersonWithInventoryCount) => {
        const count = value as number
        if (row.role !== 'collaborator') return '—'
        return (
          <div className="flex items-center gap-2">
            <span>{count} {count === 1 ? 'item' : 'itens'}</span>
            {row.low_stock_warnings > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400"
                title={`${row.low_stock_warnings} item(ns) com estoque baixo no almoxarifado`}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-amber-400">
                  <path d="M6 1L11 10H1L6 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M6 4.5V6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="6" cy="8" r="0.5" fill="currentColor" />
                </svg>
                {row.low_stock_warnings}
              </span>
            )}
          </div>
        )
      },
    },
  ]

  const roleFilterOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'leader', label: 'Líderes' },
    { value: 'collaborator', label: 'Colaboradores' },
  ]

  const statusFilterOptions = [
    { value: 'active', label: 'Ativos' },
    { value: 'inactive', label: 'Inativos' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestão de Colaboradores</h2>
          <p className="mt-1 text-sm text-gray-400">
            Cadastro de colaboradores, lideranças e seus inventários
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingPerson(null)
            setShowFormModal(true)
          }}
          leftIcon={<UsersIcon size={16} />}
        >
          Novo colaborador
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder="Buscar por nome ou matrícula..."
            value={search}
            onChange={(e) => {
              const nextValue = e.target.value
              setSearch(nextValue)
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-400">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="2" />
                <path d="M11 11L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          />
        </div>
        <div className="min-w-[140px]">
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            options={roleFilterOptions}
          />
        </div>
        <div className="min-w-[120px]">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            options={statusFilterOptions}
          />
        </div>
      </div>

      {refreshing && (
        <div className="inline-flex items-center gap-2 text-xs text-orange-200/75">
          <span className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
          Atualizando colaboradores...
        </div>
      )}

      {error && (
        <Alert variant="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable<PersonWithInventoryCount>
        columns={columns}
        data={filteredPeople}
        keyExtractor={(row) => row.id}
        isLoading={loading}
        emptyMessage="Nenhum colaborador encontrado"
        onRowClick={(row) => navigate(`/people/${row.id}`)}
      />

      {/* Paginação */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-gray-700 pt-4">
          <p className="text-sm text-gray-400">
            Mostrando {currentPage * PAGE_SIZE + 1} - {Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} de {totalCount} colaboradores
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const newPage = currentPage - 1
                setCurrentPage(newPage)
                void fetchPeople(newPage)
              }}
              disabled={currentPage === 0 || loading}
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
                const newPage = currentPage + 1
                setCurrentPage(newPage)
                void fetchPeople(newPage)
              }}
              disabled={(currentPage + 1) * PAGE_SIZE >= totalCount || loading}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      {profile && deactivatingId && (
        <ConfirmToggleModal
          person={people.find((p) => p.id === deactivatingId) ?? null}
          onConfirm={() => {
            const person = people.find((p) => p.id === deactivatingId)
            if (person) void handleToggleActive(person)
          }}
          onCancel={() => setDeactivatingId(null)}
        />
      )}

      <Modal
        isOpen={showFormModal}
        onClose={handleFormCancel}
        title={editingPerson ? 'Editar Colaborador' : 'Novo Colaborador'}
        size="lg"
      >
        <PersonForm
          person={editingPerson}
          onSubmit={handleFormSubmit}
          onCancel={handleFormCancel}
        />
      </Modal>
    </div>
  )
}

interface ConfirmToggleModalProps {
  person: PersonWithInventoryCount | null
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmToggleModal({ person, onConfirm, onCancel }: ConfirmToggleModalProps) {
  if (!person) return null

  const isDeactivating = person.is_active

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={isDeactivating ? 'Desativar Colaborador' : 'Reativar Colaborador'}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-300">
          Tem certeza que deseja {isDeactivating ? 'desativar' : 'reativar'}{' '}
          <span className="font-medium text-white">{person.full_name}</span>?
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant={isDeactivating ? 'danger' : 'primary'} onClick={onConfirm}>
            {isDeactivating ? 'Desativar' : 'Reativar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

interface RawPersonRow {
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
    stock_item_id: string
    stock_items: {
      minimum_quantity: number
      current_quantity: number
    }
  }[]
}
