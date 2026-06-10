import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { cn, formatDateTime, formatQuantity } from '../../lib/utils'
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  Select,
  Spinner,
} from '../../components/ui'
import { ClipboardIcon } from '../../components/icons'
import { ItemVisual } from '../../components/items/ItemVisual'

type StockItemRow = Tables<'stock_items'>

type MovementKind = 'entry' | 'exit' | 'return' | 'adjustment'
type MovementSource = 'audit' | 'withdrawal' | 'return'
type PeriodPreset = 'all' | 'today' | '7d' | '30d' | 'custom'

interface AuditLogRow {
  id: string
  user_id: string | null
  action: string
  table_name: string
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
  profiles: { full_name: string } | null
}

interface WithdrawalItemRow {
  id: string
  quantity: number
  unit: string
  destination_type: 'collaborator' | 'work_site' | null
  collaborator_id: string | null
  work_site_id: string | null
  collaborator: { full_name: string } | null
  work_site: { name: string } | null
  stock_item: Pick<StockItemRow, 'id' | 'code' | 'name' | 'unit' | 'svg_icon_key'> | null
  withdrawal: {
    id: string
    code: string | null
    status: string
    created_at: string
    withdrawn_at: string | null
    requested_by_person: { full_name: string } | null
    collaborator: { full_name: string } | null
    work_site: { name: string } | null
  } | null
}

interface StockReturnRow {
  id: string
  quantity: number
  approved_quantity: number
  held_quantity: number
  item_condition: 'used' | 'damaged'
  approved_condition: 'new' | 'used' | 'damaged' | null
  status: string
  approved_at: string | null
  created_at: string
  source_person: { full_name: string } | null
  source_work_site: { name: string } | null
  approved_by_profile: { full_name: string } | null
  stock_item: Pick<StockItemRow, 'id' | 'code' | 'name' | 'unit' | 'svg_icon_key'> | null
}

interface StockMovement {
  id: string
  kind: MovementKind
  source: MovementSource
  stockItemId: string | null
  itemName: string
  itemCode: string | null
  itemUnit: string
  itemIconKey: string | null
  quantity: number
  signedQuantity: number
  condition: 'new' | 'used' | 'damaged' | 'mixed' | null
  beforeQuantity: number | null
  afterQuantity: number | null
  actor: string
  target: string | null
  reference: string | null
  createdAt: string
  description: string
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'entry', label: 'Entradas' },
  { value: 'exit', label: 'Saidas' },
  { value: 'return', label: 'Devolucoes' },
  { value: 'adjustment', label: 'Ajustes manuais' },
]

const SOURCE_OPTIONS = [
  { value: 'all', label: 'Todas as origens' },
  { value: 'audit', label: 'Auditoria' },
  { value: 'withdrawal', label: 'Retiradas' },
  { value: 'return', label: 'Devolucoes' },
]

const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'custom', label: 'Personalizado' },
]

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function startOfToday(): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfToday(): Date {
  const date = new Date()
  date.setHours(23, 59, 59, 999)
  return date
}

function formatPeriodDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function numericValue(source: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textValue(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function conditionFromBucketDelta(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): StockMovement['condition'] {
  const buckets = [
    { key: 'quantity_new', condition: 'new' as const },
    { key: 'quantity_used', condition: 'used' as const },
    { key: 'quantity_damaged', condition: 'damaged' as const },
  ]

  const changed = buckets.filter(({ key }) => numericValue(oldData, key) !== numericValue(newData, key))
  return changed.length === 1 ? changed[0].condition : changed.length > 1 ? 'mixed' : null
}

function conditionLabel(condition: StockMovement['condition']): string {
  if (condition === 'new') return 'Novo'
  if (condition === 'used') return 'Usado'
  if (condition === 'damaged') return 'Avaria'
  if (condition === 'mixed') return 'Misto'
  return 'Nao informado'
}

function movementLabel(kind: MovementKind): string {
  if (kind === 'entry') return 'Entrada'
  if (kind === 'exit') return 'Saida'
  if (kind === 'return') return 'Devolucao'
  return 'Ajuste manual'
}

function movementTone(kind: MovementKind): {
  dot: string
  amount: string
  symbol: string
  badge: 'default' | 'success' | 'danger' | 'info'
} {
  if (kind === 'entry') {
    return {
      dot: 'bg-emerald-400',
      amount: 'text-emerald-300',
      symbol: '+',
      badge: 'success',
    }
  }
  if (kind === 'exit') {
    return {
      dot: 'bg-red-400',
      amount: 'text-red-300',
      symbol: '-',
      badge: 'danger',
    }
  }
  if (kind === 'return') {
    return {
      dot: 'bg-blue-400',
      amount: 'text-blue-300',
      symbol: '+',
      badge: 'info',
    }
  }
  return {
    dot: 'bg-gray-500',
    amount: 'text-gray-100',
    symbol: movementLabel(kind).slice(0, 1),
    badge: 'default',
  }
}

function sourceLabel(source: MovementSource): string {
  if (source === 'withdrawal') return 'Retirada'
  if (source === 'return') return 'Devolucao'
  return 'Auditoria'
}

function buildAuditMovements(rows: AuditLogRow[]): StockMovement[] {
  return rows.flatMap((row): StockMovement[] => {
    if (row.table_name !== 'stock_items') return []

    const oldQty = numericValue(row.old_data, 'current_quantity')
    const newQty = numericValue(row.new_data, 'current_quantity')
    const source = row.new_data ?? row.old_data
    const itemName = textValue(source, 'name') ?? 'Item de estoque'
    const itemCode = textValue(source, 'code')
    const itemUnit = textValue(source, 'unit') ?? 'un'
    const itemIconKey = textValue(source, 'svg_icon_key')
    const actor = row.profiles?.full_name ?? 'Sistema'

    if (row.action === 'INSERT') {
      const createdQuantity = newQty ?? 0
      if (createdQuantity <= 0) return []

      return [{
        id: `audit-${row.id}`,
        kind: 'entry',
        source: 'audit',
        stockItemId: row.record_id,
        itemName,
        itemCode,
        itemUnit,
        itemIconKey,
        quantity: createdQuantity,
        signedQuantity: createdQuantity,
        condition: conditionFromBucketDelta(null, row.new_data) ?? 'mixed',
        beforeQuantity: 0,
        afterQuantity: createdQuantity,
        actor,
        target: null,
        reference: 'Cadastro inicial',
        createdAt: row.created_at,
        description: 'Quantidade criada junto com o item.',
      }]
    }

    if (row.action !== 'UPDATE' || oldQty === null || newQty === null || oldQty === newQty) {
      return []
    }

    const delta = newQty - oldQty
    return [{
      id: `audit-${row.id}`,
      kind: delta > 0 ? 'entry' : 'adjustment',
      source: 'audit',
      stockItemId: row.record_id,
      itemName,
      itemCode,
      itemUnit,
      itemIconKey,
      quantity: Math.abs(delta),
      signedQuantity: delta,
      condition: conditionFromBucketDelta(row.old_data, row.new_data),
      beforeQuantity: oldQty,
      afterQuantity: newQty,
      actor,
      target: null,
      reference: 'Alteracao no estoque',
      createdAt: row.created_at,
      description: delta > 0
        ? 'Aumento detectado no saldo do item.'
        : 'Reducao ou correcao detectada no saldo do item.',
    }]
  })
}

function buildWithdrawalMovements(rows: WithdrawalItemRow[]): StockMovement[] {
  return rows
    .filter((row) => row.withdrawal && row.withdrawal.status !== 'rejected')
    .map((row) => {
      const withdrawal = row.withdrawal
      const target = row.collaborator?.full_name
        ?? row.work_site?.name
        ?? withdrawal?.collaborator?.full_name
        ?? withdrawal?.work_site?.name
        ?? null
      return {
        id: `withdrawal-${row.id}`,
        kind: 'exit' as const,
        source: 'withdrawal' as const,
        stockItemId: row.stock_item?.id ?? null,
        itemName: row.stock_item?.name ?? 'Item removido',
        itemCode: row.stock_item?.code ?? null,
        itemUnit: row.stock_item?.unit ?? row.unit,
        itemIconKey: row.stock_item?.svg_icon_key ?? null,
        quantity: row.quantity,
        signedQuantity: -row.quantity,
        condition: null,
        beforeQuantity: null,
        afterQuantity: null,
        actor: withdrawal?.requested_by_person?.full_name ?? 'Solicitante nao registrado',
        target,
        reference: withdrawal?.code ?? 'Retirada',
        createdAt: withdrawal?.withdrawn_at ?? withdrawal?.created_at ?? new Date().toISOString(),
        description: target ? `Saida registrada para ${target}.` : 'Saida registrada em retirada.',
      }
    })
}

function buildReturnMovements(rows: StockReturnRow[]): StockMovement[] {
  return rows
    .filter((row) => row.approved_quantity > 0)
    .map((row) => {
      const source = row.source_person?.full_name ?? row.source_work_site?.name ?? null
      return {
        id: `return-${row.id}`,
        kind: 'return' as const,
        source: 'return' as const,
        stockItemId: row.stock_item?.id ?? null,
        itemName: row.stock_item?.name ?? 'Item removido',
        itemCode: row.stock_item?.code ?? null,
        itemUnit: row.stock_item?.unit ?? 'un',
        itemIconKey: row.stock_item?.svg_icon_key ?? null,
        quantity: row.approved_quantity,
        signedQuantity: row.approved_quantity,
        condition: row.approved_condition ?? row.item_condition,
        beforeQuantity: null,
        afterQuantity: null,
        actor: row.approved_by_profile?.full_name ?? 'Aprovador nao registrado',
        target: source,
        reference: 'Devolucao aprovada',
        createdAt: row.approved_at ?? row.created_at,
        description: source ? `Retorno aprovado vindo de ${source}.` : 'Retorno aprovado para o estoque.',
      }
    })
}

function movementSignature(movement: StockMovement): string {
  const timeBucket = Math.round(new Date(movement.createdAt).getTime() / 10000)
  return `${movement.stockItemId ?? movement.itemCode ?? movement.itemName}:${movement.signedQuantity}:${timeBucket}`
}

function dedupeAuditWithDocumentedMovements(movements: StockMovement[]): StockMovement[] {
  const documentedSignatures = new Set(
    movements
      .filter((movement) => movement.source !== 'audit')
      .map(movementSignature),
  )

  return movements.filter((movement) => {
    if (movement.source !== 'audit') return true
    return !documentedSignatures.has(movementSignature(movement))
  })
}

export function StockMovementsTab() {
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [dateTimeFrom, setDateTimeFrom] = useState('')
  const [dateTimeTo, setDateTimeTo] = useState('')

  const loadMovements = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [auditResult, withdrawalResult, returnResult] = await Promise.all([
        supabase
          .from('audit_logs')
          .select('id, user_id, action, table_name, record_id, old_data, new_data, created_at, profiles!audit_logs_user_id_fkey(full_name)')
          .eq('table_name', 'stock_items')
          .order('created_at', { ascending: false })
          .limit(700),
        supabase
          .from('withdrawal_items')
          .select(`
            id,
            quantity,
            unit,
            destination_type,
            collaborator_id,
            work_site_id,
            collaborator:people!withdrawal_items_collaborator_id_fkey(full_name),
            work_site:work_sites!withdrawal_items_work_site_id_fkey(name),
            stock_item:stock_items(id, code, name, unit, svg_icon_key),
            withdrawal:withdrawals(
              id,
              code,
              status,
              created_at,
              withdrawn_at,
              requested_by_person:people!withdrawals_requested_by_fkey(full_name),
              collaborator:people!withdrawals_collaborator_id_fkey(full_name),
              work_site:work_sites!withdrawals_work_site_id_fkey(name)
            )
          `)
          .order('created_at', { ascending: false })
          .limit(700),
        supabase
          .from('stock_return_requests')
          .select(`
            id,
            quantity,
            approved_quantity,
            held_quantity,
            item_condition,
            approved_condition,
            status,
            approved_at,
            created_at,
            source_person:people!stock_return_requests_source_person_id_fkey(full_name),
            source_work_site:work_sites!stock_return_requests_source_work_site_id_fkey(name),
            approved_by_profile:profiles!stock_return_requests_approved_by_fkey(full_name),
            stock_item:stock_items(id, code, name, unit, svg_icon_key)
          `)
          .order('created_at', { ascending: false })
          .limit(700),
      ])

      if (auditResult.error) throw new Error(auditResult.error.message)
      if (withdrawalResult.error) throw new Error(withdrawalResult.error.message)
      if (returnResult.error) throw new Error(returnResult.error.message)

      const nextMovements = dedupeAuditWithDocumentedMovements([
        ...buildAuditMovements((auditResult.data as unknown as AuditLogRow[]) ?? []),
        ...buildWithdrawalMovements((withdrawalResult.data as unknown as WithdrawalItemRow[]) ?? []),
        ...buildReturnMovements((returnResult.data as unknown as StockReturnRow[]) ?? []),
      ]).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      setMovements(nextMovements)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nao foi possivel carregar as movimentacoes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMovements()
  }, [loadMovements])

  const filteredMovements = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()
    const rawFromTime = dateTimeFrom ? new Date(dateTimeFrom).getTime() : null
    const rawToTime = dateTimeTo ? new Date(dateTimeTo).getTime() : null
    const hasInvalidPeriod = rawFromTime !== null && rawToTime !== null && rawFromTime > rawToTime
    const fromTime = hasInvalidPeriod ? null : rawFromTime
    const toTime = hasInvalidPeriod ? null : rawToTime

    return movements.filter((movement) => {
      if (typeFilter !== 'all' && movement.kind !== typeFilter) return false
      if (sourceFilter !== 'all' && movement.source !== sourceFilter) return false

      const movementTime = new Date(movement.createdAt).getTime()
      if (fromTime !== null && movementTime < fromTime) return false
      if (toTime !== null && movementTime > toTime) return false

      if (!normalizedSearch) return true

      const haystack = [
        movement.itemName,
        movement.itemCode,
        movement.actor,
        movement.target,
        movement.reference,
        movement.description,
        movementLabel(movement.kind),
        sourceLabel(movement.source),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [dateTimeFrom, dateTimeTo, movements, searchQuery, sourceFilter, typeFilter])

  const invalidPeriod = Boolean(
    dateTimeFrom
      && dateTimeTo
      && new Date(dateTimeFrom).getTime() > new Date(dateTimeTo).getTime(),
  )

  const periodSummary = useMemo(() => {
    if (invalidPeriod) return 'Periodo inicial maior que o final.'
    if (dateTimeFrom && dateTimeTo) return `${formatPeriodDateTime(dateTimeFrom)} ate ${formatPeriodDateTime(dateTimeTo)}`
    if (dateTimeFrom) return `A partir de ${formatPeriodDateTime(dateTimeFrom)}`
    if (dateTimeTo) return `Ate ${formatPeriodDateTime(dateTimeTo)}`
    return 'Sem limite de data e hora.'
  }, [dateTimeFrom, dateTimeTo, invalidPeriod])

  const handlePeriodPresetChange = (preset: PeriodPreset) => {
    setPeriodPreset(preset)

    if (preset === 'custom') return

    if (preset === 'all') {
      setDateTimeFrom('')
      setDateTimeTo('')
      return
    }

    const end = endOfToday()
    const start = startOfToday()

    if (preset === '7d') {
      start.setDate(start.getDate() - 6)
    }

    if (preset === '30d') {
      start.setDate(start.getDate() - 29)
    }

    setDateTimeFrom(toDateTimeLocalValue(start))
    setDateTimeTo(toDateTimeLocalValue(end))
  }

  const stats = useMemo(() => {
    return filteredMovements.reduce(
      (acc, movement) => {
        if (movement.kind === 'entry') acc.entries += movement.quantity
        if (movement.kind === 'exit') acc.exits += movement.quantity
        if (movement.kind === 'return') acc.returns += movement.quantity
        if (movement.kind === 'adjustment') acc.adjustments += 1
        return acc
      },
      { entries: 0, exits: 0, returns: 0, adjustments: 0 },
    )
  }, [filteredMovements])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Spinner size="lg" />
        <p className="mt-4 text-sm text-gray-400">Carregando movimentacoes...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-white/8 bg-gray-900 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-gray-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
              Historico do estoque
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">Movimentacoes</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Entradas, saidas, devolucoes e ajustes reconstruidos a partir das retiradas, devolucoes e auditoria ja existentes.
            </p>
          </div>

          <div className="rounded-lg border border-white/8 bg-gray-950/50 px-4 py-3 text-sm text-gray-300">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Eventos visiveis</p>
            <p className="mt-1 text-2xl font-semibold text-white">{filteredMovements.length}</p>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="danger" title="Erro ao carregar movimentacoes">
          {error}
        </Alert>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MovementStat title="Entradas" value={`+${stats.entries}`} tone="entry" subtitle="Itens adicionados" />
        <MovementStat title="Saidas" value={`-${stats.exits}`} tone="exit" subtitle="Itens retirados" />
        <MovementStat title="Devolucoes" value={`+${stats.returns}`} tone="return" subtitle="Voltaram ao estoque" />
        <MovementStat title="Ajustes manuais" value={stats.adjustments} tone="adjustment" subtitle="Correcoes detectadas" />
      </div>

      <Card variant="bordered" className="border-white/8 bg-gray-900 shadow-[0_12px_26px_rgba(0,0,0,0.10)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-white">Filtros</p>
            <p className="mt-1 text-xs text-gray-500">Use para encontrar um item, responsavel ou periodo especifico.</p>
          </div>
          {(searchQuery || typeFilter !== 'all' || sourceFilter !== 'all' || periodPreset !== 'all' || dateTimeFrom || dateTimeTo) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setTypeFilter('all')
                setSourceFilter('all')
                setPeriodPreset('all')
                setDateTimeFrom('')
                setDateTimeTo('')
              }}
              className="rounded-lg border border-white/8 bg-gray-950/50 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/8 hover:text-white"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.5fr_1fr_1fr_1.1fr]">
          <Input
            placeholder="Buscar por item, codigo, responsavel ou referencia..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            leftIcon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="2" />
                <path d="M11 11L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          />
          <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} options={TYPE_OPTIONS} />
          <Select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} options={SOURCE_OPTIONS} />
          <Select
            value={periodPreset}
            onChange={(event) => handlePeriodPresetChange(event.target.value as PeriodPreset)}
            options={PERIOD_PRESETS}
            aria-label="Periodo"
          />
        </div>

        <div className="mt-3 grid gap-3 rounded-xl border border-white/8 bg-gray-950/35 p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Inicio</span>
            <input
              type="datetime-local"
              value={dateTimeFrom}
              onChange={(event) => {
                setPeriodPreset('custom')
                setDateTimeFrom(event.target.value)
              }}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              aria-label="Data e hora inicial"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Fim</span>
            <input
              type="datetime-local"
              value={dateTimeTo}
              min={dateTimeFrom || undefined}
              onChange={(event) => {
                setPeriodPreset('custom')
                setDateTimeTo(event.target.value)
              }}
              className={cn(
                'w-full rounded-lg border bg-gray-950 px-3 py-2 text-sm text-white transition-colors focus:outline-none focus:ring-2',
                invalidPeriod
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500/40'
                  : 'border-gray-700 focus:border-orange-500 focus:ring-orange-500/50',
              )}
              aria-label="Data e hora final"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setPeriodPreset('today')
              setDateTimeFrom(toDateTimeLocalValue(startOfToday()))
              setDateTimeTo(toDateTimeLocalValue(endOfToday()))
            }}
            className="rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/8 hover:text-white"
          >
            Hoje
          </button>
        </div>

        <div className={cn(
          'mt-3 rounded-lg border px-3 py-2 text-xs',
          invalidPeriod
            ? 'border-red-500/20 bg-red-500/10 text-red-300'
            : 'border-white/8 bg-gray-950/35 text-gray-400',
        )}>
          Periodo aplicado: <span className="text-gray-200">{periodSummary}</span>
        </div>
      </Card>

      {filteredMovements.length === 0 ? (
        <EmptyState
          icon={<ClipboardIcon size={48} />}
          title="Nenhuma movimentacao encontrada"
          description="Tente limpar filtros ou ampliar o periodo pesquisado."
        />
      ) : (
        <div className="relative">
          <div className="absolute bottom-0 left-6 top-0 hidden w-px bg-gradient-to-b from-white/12 via-white/8 to-transparent md:block" />
          <div className="flex flex-col gap-3">
            {filteredMovements.map((movement) => (
              <MovementCard key={movement.id} movement={movement} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MovementStat({
  title,
  value,
  tone,
  subtitle,
}: {
  title: string
  value: number | string
  tone: MovementKind
  subtitle: string
}) {
  const style = movementTone(tone)

  return (
    <Card variant="bordered" className="border-white/8 bg-gray-900 shadow-[0_10px_22px_rgba(0,0,0,0.10)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{title}</p>
          <p className={cn('mt-2 text-2xl font-semibold', style.amount)}>{value}</p>
          <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
        </div>
        <span className={cn('mt-1 flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-gray-950/50 text-sm font-semibold', style.amount)}>
          {style.symbol}
        </span>
      </div>
    </Card>
  )
}

function MovementCard({ movement }: { movement: StockMovement }) {
  const tone = movementTone(movement.kind)
  const sign = movement.signedQuantity > 0 ? '+' : '-'

  return (
    <Card
      variant="bordered"
      className="relative overflow-hidden border-white/8 bg-gray-900 shadow-[0_12px_26px_rgba(0,0,0,0.10)] transition-colors hover:border-white/14 md:ml-14"
    >
      <span className={cn('absolute -left-[39px] top-7 hidden h-3 w-3 rounded-full ring-4 ring-gray-950 md:block', tone.dot)} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gray-950/55">
            <ItemVisual iconKey={movement.itemIconKey} size={34} />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <MovementPill movement={movement} />
              <Badge variant="default">{sourceLabel(movement.source)}</Badge>
              {movement.condition && (
                <Badge variant="default">{conditionLabel(movement.condition)}</Badge>
              )}
            </div>

            <h3 className="mt-3 text-base font-semibold text-white">{movement.itemName}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="font-mono text-gray-300">{movement.itemCode ?? '-'}</span>
              <span>{formatDateTime(movement.createdAt)}</span>
              {movement.reference && <span>{movement.reference}</span>}
            </div>

            <p className="mt-3 text-sm text-gray-300">{movement.description}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <MiniPill label="Responsavel" value={movement.actor} />
              {movement.target && <MiniPill label="Origem/Destino" value={movement.target} />}
              {movement.beforeQuantity !== null && movement.afterQuantity !== null && (
                <MiniPill
                  label="Antes/depois"
                  value={`${movement.beforeQuantity} -> ${movement.afterQuantity}`}
                />
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-white/8 bg-gray-950/50 px-4 py-3 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Quantidade</p>
          <p className={cn('mt-1 text-2xl font-semibold', tone.amount)}>
            {sign}{formatQuantity(movement.quantity, movement.itemUnit)}
          </p>
        </div>
      </div>
    </Card>
  )
}

function MovementPill({ movement }: { movement: StockMovement }) {
  const tone = movementTone(movement.kind)

  return (
    <span className={cn(
      'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium',
      tone.badge === 'success' && 'bg-emerald-500/12 text-emerald-300',
      tone.badge === 'danger' && 'bg-red-500/12 text-red-300',
      tone.badge === 'info' && 'bg-blue-500/12 text-blue-300',
      tone.badge === 'default' && 'bg-gray-800 text-gray-300',
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {movementLabel(movement.kind)}
    </span>
  )
}

function MiniPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-white/8 bg-gray-950/45 px-3 py-1 text-xs text-gray-300">
      <span className="shrink-0 text-gray-500">{label}:</span>
      <span className="truncate text-gray-200">{value}</span>
    </span>
  )
}
