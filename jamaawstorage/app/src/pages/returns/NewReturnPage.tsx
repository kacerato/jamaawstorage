import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { StockItemCondition, StockReturnReason, StockReturnSourceType, Tables } from '../../types/database'
import { formatQuantity } from '../../lib/utils'
import { Alert, Badge, Button, Card, EmptyState, Input, Select, SectionLabel, Spinner } from '../../components/ui'
import { BuildingIcon, PackageIcon, UserIcon } from '../../components/icons'
import { ItemVisual } from '../../components/items/ItemVisual'

type PersonRow = Tables<'people'>
type WorkSiteRow = Tables<'work_sites'>
type StockItemRow = Tables<'stock_items'>

interface AvailableItem {
  stockItemId: string
  code: string | null
  name: string
  unit: string
  iconKey: string | null
  availableQuantity: number
}

interface SelectionState {
  quantity: string
  condition: StockItemCondition
}

const REASON_OPTIONS: { value: StockReturnReason; label: string }[] = [
  { value: 'termination', label: 'Desligamento do colaborador' },
  { value: 'work_site_closure', label: 'Encerramento de obra' },
  { value: 'exchange', label: 'Troca de material' },
  { value: 'general', label: 'Devolução avulsa' },
]

const CONDITION_OPTIONS: { value: StockItemCondition; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'used', label: 'Usado' },
  { value: 'damaged', label: 'Avariado' },
]

export function NewReturnPage() {
  const navigate = useNavigate()

  const [sourceType, setSourceType] = useState<StockReturnSourceType>('collaborator')
  const [personId, setPersonId] = useState('')
  const [workSiteId, setWorkSiteId] = useState('')
  const [reason, setReason] = useState<StockReturnReason>('termination')
  const [notes, setNotes] = useState('')

  const [people, setPeople] = useState<PersonRow[]>([])
  const [workSites, setWorkSites] = useState<WorkSiteRow[]>([])
  const [availableItems, setAvailableItems] = useState<AvailableItem[]>([])
  const [selection, setSelection] = useState<Record<string, SelectionState>>({})

  const [loadingSources, setLoadingSources] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadSources = async () => {
      setLoadingSources(true)
      const [peopleResult, siteResult] = await Promise.all([
        supabase.from('people').select('*').eq('is_active', true).order('full_name'),
        supabase.from('work_sites').select('*').order('name'),
      ])

      if (peopleResult.error) setError(peopleResult.error.message)
      else setPeople(peopleResult.data ?? [])

      if (siteResult.error) setError(siteResult.error.message)
      else setWorkSites(siteResult.data ?? [])

      setLoadingSources(false)
    }

    void loadSources()
  }, [])

  // O que pode ser devolvido é exatamente o que o colaborador tem em mãos.
  // Para obra não existe inventário por destino, então a lista é o catálogo.
  const loadAvailableItems = useCallback(async () => {
    setSelection({})
    setAvailableItems([])

    if (sourceType === 'collaborator') {
      if (!personId) return

      setLoadingItems(true)
      const { data, error: inventoryError } = await supabase
        .from('person_inventories')
        .select('quantity, stock_items(id, code, name, unit, svg_icon_key)')
        .eq('person_id', personId)
        .gt('quantity', 0)

      if (inventoryError) {
        setError(inventoryError.message)
        setLoadingItems(false)
        return
      }

      const rows = (data ?? []) as unknown as {
        quantity: number
        stock_items: Pick<StockItemRow, 'id' | 'code' | 'name' | 'unit' | 'svg_icon_key'> | null
      }[]

      setAvailableItems(
        rows
          .filter((row) => row.stock_items)
          .map((row) => ({
            stockItemId: row.stock_items!.id,
            code: row.stock_items!.code,
            name: row.stock_items!.name,
            unit: row.stock_items!.unit,
            iconKey: row.stock_items!.svg_icon_key,
            availableQuantity: row.quantity,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      )
      setLoadingItems(false)
      return
    }

    if (!workSiteId) return

    setLoadingItems(true)
    const { data, error: itemsError } = await supabase
      .from('stock_items')
      .select('id, code, name, unit, svg_icon_key')
      .order('name')

    if (itemsError) {
      setError(itemsError.message)
      setLoadingItems(false)
      return
    }

    setAvailableItems(
      (data ?? []).map((item) => ({
        stockItemId: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        iconKey: item.svg_icon_key,
        availableQuantity: Number.POSITIVE_INFINITY,
      })),
    )
    setLoadingItems(false)
  }, [sourceType, personId, workSiteId])

  useEffect(() => {
    void loadAvailableItems()
  }, [loadAvailableItems])

  const selectedCount = useMemo(
    () => Object.values(selection).filter((entry) => Number.parseInt(entry.quantity, 10) > 0).length,
    [selection],
  )

  const toggleItem = (item: AvailableItem) => {
    setSelection((previous) => {
      const next = { ...previous }
      if (next[item.stockItemId]) {
        delete next[item.stockItemId]
        return next
      }

      next[item.stockItemId] = {
        quantity: Number.isFinite(item.availableQuantity) ? String(item.availableQuantity) : '1',
        condition: 'used',
      }
      return next
    })
  }

  const updateSelection = (stockItemId: string, patch: Partial<SelectionState>) => {
    setSelection((previous) => ({
      ...previous,
      [stockItemId]: { ...previous[stockItemId], ...patch },
    }))
  }

  // Desligamento devolve tudo: sem isso a tela vira digitação item a item.
  const selectEverything = () => {
    setSelection(
      Object.fromEntries(
        availableItems.map((item) => [
          item.stockItemId,
          {
            quantity: Number.isFinite(item.availableQuantity) ? String(item.availableQuantity) : '1',
            condition: 'used' as StockItemCondition,
          },
        ]),
      ),
    )
  }

  const handleSubmit = async () => {
    setError(null)

    if (sourceType === 'collaborator' && !personId) {
      setError('Selecione o colaborador que está devolvendo.')
      return
    }

    if (sourceType === 'work_site' && !workSiteId) {
      setError('Selecione a obra de origem.')
      return
    }

    const items = Object.entries(selection)
      .map(([stockItemId, entry]) => ({
        stock_item_id: stockItemId,
        quantity: Number.parseInt(entry.quantity, 10),
        reported_condition: entry.condition,
      }))
      .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0)

    if (items.length === 0) {
      setError('Selecione ao menos um item com quantidade maior que zero.')
      return
    }

    const invalid = items.find((item) => {
      const available = availableItems.find((candidate) => candidate.stockItemId === item.stock_item_id)
      return available ? item.quantity > available.availableQuantity : false
    })

    if (invalid) {
      const available = availableItems.find((candidate) => candidate.stockItemId === invalid.stock_item_id)
      setError(`A quantidade de "${available?.name}" passa do disponível (${available?.availableQuantity}).`)
      return
    }

    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('create_return_draft', {
        p_source_type: sourceType,
        p_source_person_id: sourceType === 'collaborator' ? personId : null,
        p_source_work_site_id: sourceType === 'work_site' ? workSiteId : null,
        p_items: items,
        p_reason: reason,
        p_notes: notes.trim() || null,
      })

      if (rpcError) throw new Error(rpcError.message)
      if (!data) throw new Error('Não foi possível criar a devolução.')

      navigate(`/returns/${data.id}`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível criar a devolução.')
      setSubmitting(false)
    }
  }

  if (loadingSources) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Nova devolução</h1>
        <p className="mt-1 text-sm text-gray-400">
          Selecione a origem e os itens. O termo em PDF é gerado quando você confirmar o recebimento.
        </p>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Card variant="bordered">
        <SectionLabel label="Origem" />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={sourceType === 'collaborator' ? 'primary' : 'secondary'}
              onClick={() => setSourceType('collaborator')}
              className="flex-1"
              leftIcon={<UserIcon className="h-4 w-4" />}
            >
              Colaborador
            </Button>
            <Button
              type="button"
              variant={sourceType === 'work_site' ? 'primary' : 'secondary'}
              onClick={() => setSourceType('work_site')}
              className="flex-1"
              leftIcon={<BuildingIcon className="h-4 w-4" />}
            >
              Obra
            </Button>
          </div>

          {sourceType === 'collaborator' ? (
            <Select
              label="Colaborador"
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
              options={[
                { value: '', label: 'Selecione...' },
                ...people.map((person) => ({
                  value: person.id,
                  label: person.employee_id ? `${person.full_name} (${person.employee_id})` : person.full_name,
                })),
              ]}
            />
          ) : (
            <Select
              label="Obra"
              value={workSiteId}
              onChange={(event) => setWorkSiteId(event.target.value)}
              options={[
                { value: '', label: 'Selecione...' },
                ...workSites.map((site) => ({ value: site.id, label: site.name })),
              ]}
            />
          )}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Select
            label="Motivo"
            value={reason}
            onChange={(event) => setReason(event.target.value as StockReturnReason)}
            options={REASON_OPTIONS}
          />
          <Input
            label="Observações"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional"
          />
        </div>
      </Card>

      <Card variant="bordered">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel
            label={sourceType === 'collaborator' ? 'Itens em posse do colaborador' : 'Itens do catálogo'}
          />
          {availableItems.length > 0 && (
            <Button type="button" variant="secondary" size="sm" onClick={selectEverything}>
              Devolver tudo
            </Button>
          )}
        </div>

        {loadingItems ? (
          <div className="flex min-h-[160px] items-center justify-center">
            <Spinner />
          </div>
        ) : availableItems.length === 0 ? (
          <EmptyState
            icon={<PackageIcon className="h-10 w-10" />}
            title={
              sourceType === 'collaborator'
                ? personId
                  ? 'Este colaborador não possui itens em inventário'
                  : 'Selecione um colaborador'
                : 'Selecione uma obra'
            }
            description={
              sourceType === 'collaborator' && personId
                ? 'Não há nada registrado em nome dele para devolver.'
                : 'A lista de itens aparece depois da escolha da origem.'
            }
          />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {availableItems.map((item) => {
              const entry = selection[item.stockItemId]
              const isSelected = Boolean(entry)

              return (
                <div
                  key={item.stockItemId}
                  className={`rounded-lg border p-3 transition ${
                    isSelected
                      ? 'border-orange-500/40 bg-orange-500/5'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItem(item)}
                      className="h-4 w-4 accent-orange-500"
                      aria-label={`Selecionar ${item.name}`}
                    />
                    <ItemVisual iconKey={item.iconKey} alt={item.name} className="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">{item.name}</p>
                      <p className="font-mono text-xs text-orange-300">{item.code ?? '-'}</p>
                    </div>
                    {Number.isFinite(item.availableQuantity) && (
                      <Badge variant="default" size="sm">
                        Tem {formatQuantity(item.availableQuantity, item.unit)}
                      </Badge>
                    )}
                  </div>

                  {isSelected && (
                    <div className="mt-3 grid gap-3 pl-7 md:grid-cols-2">
                      <Input
                        label="Quantidade a devolver"
                        type="number"
                        min={1}
                        max={Number.isFinite(item.availableQuantity) ? item.availableQuantity : undefined}
                        value={entry.quantity}
                        onChange={(event) => updateSelection(item.stockItemId, { quantity: event.target.value })}
                      />
                      <Select
                        label="Estado declarado"
                        value={entry.condition}
                        onChange={(event) =>
                          updateSelection(item.stockItemId, {
                            condition: event.target.value as StockItemCondition,
                          })
                        }
                        options={CONDITION_OPTIONS}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          {selectedCount > 0 ? `${selectedCount} item(ns) selecionado(s).` : 'Nenhum item selecionado.'}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/returns')} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || selectedCount === 0}>
            {submitting ? 'Criando...' : 'Continuar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
