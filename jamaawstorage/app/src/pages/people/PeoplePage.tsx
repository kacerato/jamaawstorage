import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Tables, AppRole } from '../../types/database'
import { supabase } from '../../lib/supabase'

import { useAuth } from '../../hooks/useAuth'
import { Button, Input, Select, Badge, DataTable, Modal, Alert } from '../../components/ui'
import { UsersIcon, UserIcon, HelmetIcon } from '../../components/icons'
import { PersonForm } from './PersonForm'

type PersonWithInventoryCount = Tables<'people'> & {
  inventory_count: number
  low_stock_warnings: number
}

type RoleFilter = 'all' | 'leader' | 'collaborator'
type StatusFilter = 'active' | 'inactive'

export function PeoplePage() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [people, setPeople] = useState<PersonWithInventoryCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  const [showFormModal, setShowFormModal] = useState(false)
  const [editingPerson, setEditingPerson] = useState<Tables<'people'> | null>(null)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('people')
      .select('*, person_inventories(stock_item_id, stock_items(minimum_quantity, current_quantity))')
      .order('full_name')

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    if (!data) {
      setPeople([])
      setLoading(false)
      return
    }

    const enriched: PersonWithInventoryCount[] = (data as unknown as RawPersonRow[]).map(
      (row) => {
        const inventories = row.person_inventories ?? []
        let lowStockWarnings = 0
        for (const inv of inventories) {
          const stockItem = inv.stock_items as unknown as { minimum_quantity: number; current_quantity: number } | null
          if (stockItem && stockItem.current_quantity <= stockItem.minimum_quantity) {
            lowStockWarnings++
          }
        }
        return {
          id: row.id,
          full_name: row.full_name,
          employee_id: row.employee_id,
          role: row.role,
          sector: row.sector,
          photo_url: row.photo_url,
          is_active: row.is_active,
          created_at: row.created_at,
          updated_at: row.updated_at,
          inventory_count: inventories.length,
          low_stock_warnings: lowStockWarnings,
        }
      },
    )

    setPeople(enriched)
    setLoading(false)
  }, [])

  useEffect(() => {
    setTimeout(() => void fetchPeople(), 0)
  }, [fetchPeople])

  const filteredPeople = useMemo(() => {
    return people.filter((person) => {
      const matchesSearch =
        search === '' ||
        person.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (person.employee_id ?? '').toLowerCase().includes(search.toLowerCase())

      const matchesRole = roleFilter === 'all' || person.role === roleFilter

      const matchesStatus =
        (statusFilter === 'active' && person.is_active) ||
        (statusFilter === 'inactive' && !person.is_active)

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [people, search, roleFilter, statusFilter])

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
          <h2 className="text-2xl font-bold text-white">Gestão de Pessoas</h2>
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
          Nova Pessoa
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder="Buscar por nome ou matrícula..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
        emptyMessage="Nenhuma pessoa encontrada"
        onRowClick={(row) => navigate(`/people/${row.id}`)}
      />

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
        title={editingPerson ? 'Editar Pessoa' : 'Nova Pessoa'}
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
      title={isDeactivating ? 'Desativar Pessoa' : 'Reativar Pessoa'}
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
  role: AppRole
  sector: string | null
  photo_url: string | null
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
