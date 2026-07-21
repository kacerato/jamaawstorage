import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, ExternalLink, Filter, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { cn, formatDateTime, formatQuantity } from '../../lib/utils'
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner } from '../../components/ui'
import { ClipboardIcon } from '../../components/icons'
import { ItemVisual } from '../../components/items/ItemVisual'

type MovementKind = 'initial_entry' | 'entry' | 'exit' | 'return' | 'received' | 'triage' | 'restoration' | 'adjustment' | 'reclassification' | 'cancelled'
type MovementSource = 'manual' | 'withdrawal' | 'return' | 'import' | 'assistant' | 'system'
type PeriodPreset = 'all' | 'today' | '7d' | '30d' | 'custom'

interface MovementEventRow {
  id: string
  operation_id: string
  stock_item_id: string
  event_kind: MovementKind
  source: MovementSource
  quantity_delta: number
  quantity_new_delta: number
  quantity_used_delta: number
  quantity_damaged_delta: number
  balance_before: number | null
  balance_after: number | null
  actor_id: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  related_code: string | null
  counterparty_type: string | null
  counterparty_id: string | null
  counterparty_name: string | null
  description: string | null
  metadata: Record<string, unknown>
  provenance: 'live' | 'backfill'
  created_at: string
  stock_item: {
    id: string
    code: string
    name: string
    unit: string
    svg_icon_key: string | null
  } | null
  actor: { full_name: string } | null
}

interface MovementOperation {
  id: string
  events: MovementEventRow[]
  primary: MovementEventRow
  quantityDelta: number
  newDelta: number
  usedDelta: number
  damagedDelta: number
  balanceBefore: number | null
  balanceAfter: number | null
  createdAt: string
}

const PAGE_SIZE = 120

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'entry', label: 'Entradas' },
  { value: 'exit', label: 'Saídas' },
  { value: 'return', label: 'Devoluções' },
  { value: 'adjustment', label: 'Ajustes' },
]

const SOURCE_OPTIONS = [
  { value: 'all', label: 'Todas as origens' },
  { value: 'manual', label: 'Manual' },
  { value: 'withdrawal', label: 'Retiradas' },
  { value: 'return', label: 'Devoluções' },
  { value: 'assistant', label: 'Assistente Kimi' },
  { value: 'import', label: 'Importações' },
]

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Todo o período' },
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'custom', label: 'Personalizado' },
]

function dateTimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function startOfDay(daysAgo = 0): Date {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(): Date {
  const date = new Date()
  date.setHours(23, 59, 59, 999)
  return date
}

function movementLabel(kind: MovementKind): string {
  switch (kind) {
    case 'initial_entry': return 'Estoque inicial'
    case 'entry': return 'Entrada'
    case 'exit': return 'Saída'
    case 'return': return 'Devolução ao estoque'
    case 'received': return 'Devolução recebida'
    case 'triage': return 'Em triagem'
    case 'restoration': return 'Estoque restaurado'
    case 'reclassification': return 'Reclassificação'
    case 'cancelled': return 'Cancelado'
    default: return 'Ajuste'
  }
}

function sourceLabel(source: MovementSource): string {
  switch (source) {
    case 'withdrawal': return 'Retirada'
    case 'return': return 'Devolução'
    case 'assistant': return 'Kimi'
    case 'import': return 'Importação'
    case 'system': return 'Sistema'
    default: return 'Manual'
  }
}

function typeBucket(operation: MovementOperation): 'entry' | 'exit' | 'return' | 'adjustment' {
  if (operation.events.some((event) => event.source === 'return')) return 'return'
  if (operation.quantityDelta < 0 || operation.primary.event_kind === 'exit') return 'exit'
  if (operation.quantityDelta > 0 && operation.primary.event_kind !== 'restoration') return 'entry'
  return 'adjustment'
}

function toneFor(operation: MovementOperation) {
  const bucket = typeBucket(operation)
  if (bucket === 'entry') return { dot: 'bg-emerald-400', amount: 'text-emerald-300', badge: 'success' as const }
  if (bucket === 'exit') return { dot: 'bg-red-400', amount: 'text-red-300', badge: 'danger' as const }
  if (bucket === 'return') return { dot: 'bg-sky-400', amount: 'text-sky-300', badge: 'info' as const }
  return { dot: 'bg-amber-400', amount: 'text-amber-200', badge: 'warning' as const }
}

function groupOperations(events: MovementEventRow[]): MovementOperation[] {
  const grouped = new Map<string, MovementEventRow[]>()
  for (const event of events) {
    const key = `${event.operation_id}:${event.stock_item_id}`
    grouped.set(key, [...(grouped.get(key) ?? []), event])
  }

  return Array.from(grouped.entries()).map(([id, group]) => {
    const ordered = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const primary = [...ordered].reverse().find((event) => event.quantity_delta !== 0) ?? ordered[ordered.length - 1]
    const balanceEventFirst = ordered.find((event) => event.balance_before !== null)
    const balanceEventLast = [...ordered].reverse().find((event) => event.balance_after !== null)
    return {
      id,
      events: ordered,
      primary,
      quantityDelta: ordered.reduce((total, event) => total + event.quantity_delta, 0),
      newDelta: ordered.reduce((total, event) => total + event.quantity_new_delta, 0),
      usedDelta: ordered.reduce((total, event) => total + event.quantity_used_delta, 0),
      damagedDelta: ordered.reduce((total, event) => total + event.quantity_damaged_delta, 0),
      balanceBefore: balanceEventFirst?.balance_before ?? null,
      balanceAfter: balanceEventLast?.balance_after ?? null,
      createdAt: ordered[ordered.length - 1].created_at,
    }
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function StockMovementsTab() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const itemFilter = searchParams.get('item')
  const [events, setEvents] = useState<MovementEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('30d')
  const [from, setFrom] = useState(dateTimeLocal(startOfDay(29)))
  const [to, setTo] = useState(dateTimeLocal(endOfDay()))
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadEvents = useCallback(async (append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    const offset = append ? events.length : 0

    try {
      let query = supabase
        .from('stock_movement_events')
        .select(`
          id, operation_id, stock_item_id, event_kind, source,
          quantity_delta, quantity_new_delta, quantity_used_delta, quantity_damaged_delta,
          balance_before, balance_after, actor_id, related_entity_type, related_entity_id,
          related_code, counterparty_type, counterparty_id, counterparty_name,
          description, metadata, provenance, created_at,
          stock_item:stock_items(id, code, name, unit, svg_icon_key),
          actor:profiles!stock_movement_events_actor_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)

      if (itemFilter) query = query.eq('stock_item_id', itemFilter)
      if (sourceFilter !== 'all') query = query.eq('source', sourceFilter as MovementSource)
      if (from) query = query.gte('created_at', new Date(from).toISOString())
      if (to) query = query.lte('created_at', new Date(to).toISOString())

      const { data, error: queryError } = await query
      if (queryError) throw queryError
      const rows = (data as unknown as MovementEventRow[]) ?? []
      setEvents((current) => append ? [...current, ...rows] : rows)
      setHasMore(rows.length === PAGE_SIZE)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as movimentações.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [events.length, from, itemFilter, sourceFilter, to])

  useEffect(() => {
    void loadEvents(false)
    // Recarrega quando os filtros persistidos no servidor mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, itemFilter, sourceFilter, to])

  const operations = useMemo(() => groupOperations(events), [events])
  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR')
    return operations.filter((operation) => {
      if (typeFilter !== 'all' && typeBucket(operation) !== typeFilter) return false
      if (!normalized) return true
      const event = operation.primary
      return [
        event.stock_item?.name,
        event.stock_item?.code,
        event.related_code,
        event.counterparty_name,
        event.actor?.full_name,
        event.description,
        movementLabel(event.event_kind),
      ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(normalized)
    })
  }, [operations, search, typeFilter])

  const stats = useMemo(() => filtered.reduce((summary, operation) => {
    const bucket = typeBucket(operation)
    if (bucket === 'entry') summary.entries += Math.max(operation.quantityDelta, 0)
    if (bucket === 'exit') summary.exits += Math.abs(Math.min(operation.quantityDelta, 0))
    if (bucket === 'return') summary.returns += Math.max(operation.quantityDelta, 0)
    if (bucket === 'adjustment') summary.adjustments += 1
    return summary
  }, { entries: 0, exits: 0, returns: 0, adjustments: 0 }), [filtered])

  const applyPeriod = (preset: PeriodPreset) => {
    setPeriodPreset(preset)
    if (preset === 'custom') {
      setShowAdvanced(true)
      return
    }
    if (preset === 'all') {
      setFrom('')
      setTo('')
      return
    }
    setFrom(dateTimeLocal(startOfDay(preset === 'today' ? 0 : preset === '7d' ? 6 : 29)))
    setTo(dateTimeLocal(endOfDay()))
  }

  const resetFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setSourceFilter('all')
    applyPeriod('30d')
  }

  const openRelated = (operation: MovementOperation) => {
    const event = operation.primary
    if (event.related_entity_type === 'withdrawal' && event.related_entity_id) {
      navigate(`/withdrawals/${event.related_entity_id}`)
      return
    }
    if (event.related_entity_type === 'return_request') {
      const withdrawalId = typeof event.metadata?.withdrawal_id === 'string' ? event.metadata.withdrawal_id : null
      if (withdrawalId) {
        navigate(`/withdrawals/${withdrawalId}?from=movements`)
      } else {
        navigate(`/stock?tab=returns&return=${event.related_entity_id ?? ''}`)
      }
      return
    }
    navigate(`/stock?tab=items&item=${event.stock_item_id}`)
  }

  if (loading && events.length === 0) {
    return <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/8 bg-[#111216] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.14)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="min-w-0 xl:w-64">
            <h2 className="text-lg font-semibold text-white">Histórico de movimentações</h2>
            <p className="mt-0.5 text-xs text-gray-500">Saldo real, origem e responsável em uma única timeline.</p>
          </div>

          <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.5fr)_minmax(150px,0.8fr)_minmax(160px,0.8fr)_auto]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Item, código, pessoa ou referência"
            />
            <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} options={TYPE_OPTIONS} />
            <Select value={periodPreset} onChange={(event) => applyPeriod(event.target.value as PeriodPreset)} options={PERIOD_OPTIONS} />
            <Button
              variant="secondary"
              onClick={() => setShowAdvanced((current) => !current)}
              leftIcon={<Filter size={15} />}
            >
              Filtros
            </Button>
          </div>
        </div>

        {showAdvanced && (
          <div className="mt-3 grid gap-2 border-t border-white/8 pt-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <Select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} options={SOURCE_OPTIONS} label="Origem" />
            <Input label="De" type="datetime-local" value={from} onChange={(event) => { setPeriodPreset('custom'); setFrom(event.target.value) }} />
            <Input label="Até" type="datetime-local" value={to} onChange={(event) => { setPeriodPreset('custom'); setTo(event.target.value) }} />
            <Button variant="ghost" onClick={resetFilters} leftIcon={<RotateCcw size={14} />}>Limpar</Button>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CompactStat label="Entradas" value={`+${stats.entries}`} tone="text-emerald-300" />
        <CompactStat label="Saídas" value={`-${stats.exits}`} tone="text-red-300" />
        <CompactStat label="Devoluções" value={`+${stats.returns}`} tone="text-sky-300" />
        <CompactStat label="Ajustes" value={stats.adjustments} tone="text-amber-200" />
      </div>

      {itemFilter && (
        <div className="flex items-center justify-between rounded-xl border border-orange-400/15 bg-orange-500/8 px-3 py-2 text-sm text-orange-100">
          <span>Exibindo somente as movimentações deste item.</span>
          <Button size="sm" variant="ghost" onClick={() => navigate('/stock?tab=movements')}>Ver todos</Button>
        </div>
      )}

      {error && <Alert variant="danger" title="Histórico indisponível">{error}</Alert>}

      {filtered.length === 0 && !error ? (
        <EmptyState
          icon={<ClipboardIcon size={42} />}
          title="Nenhuma movimentação encontrada"
          description="Altere o período ou limpe os filtros para ampliar a busca."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((operation) => (
            <MovementRow key={operation.id} operation={operation} onOpen={() => openRelated(operation)} />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" isLoading={loadingMore} onClick={() => void loadEvents(true)}>
            Carregar movimentações anteriores
          </Button>
        </div>
      )}
    </div>
  )
}

function CompactStat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <strong className={cn('text-sm font-semibold', tone)}>{value}</strong>
    </div>
  )
}

function MovementRow({ operation, onOpen }: { operation: MovementOperation; onOpen: () => void }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const event = operation.primary
  const tone = toneFor(operation)
  const unit = event.stock_item?.unit ?? 'un'
  const hasDetails = operation.events.length > 1
  const sign = operation.quantityDelta > 0 ? '+' : ''

  return (
    <article className="overflow-hidden rounded-2xl border border-white/8 bg-[#111216] transition-colors hover:border-white/14">
      <div className="grid gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <button
          type="button"
          onClick={() => navigate(`/stock?tab=items&item=${event.stock_item_id}`)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-black/20"
          aria-label={`Abrir ${event.stock_item?.name ?? 'item'}`}
        >
          <ItemVisual iconKey={event.stock_item?.svg_icon_key ?? null} size={28} />
        </button>

        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={tone.badge} size="sm">{movementLabel(event.event_kind)}</Badge>
            <Badge variant="default" size="sm">{sourceLabel(event.source)}</Badge>
            {event.related_code && <span className="font-mono text-xs text-orange-300">{event.related_code}</span>}
            {event.provenance === 'backfill' && <span className="text-[10px] text-gray-600">histórico migrado</span>}
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-sm font-semibold text-white">{event.stock_item?.name ?? 'Item removido'}</h3>
            <span className="text-xs text-gray-500">{event.counterparty_name ?? event.actor?.full_name ?? 'Sistema'}</span>
            <span className="text-xs text-gray-600">{formatDateTime(operation.createdAt)}</span>
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-gray-400">{event.description ?? 'Movimentação registrada.'}</p>
        </button>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div className="text-right">
            <p className={cn('text-base font-semibold', tone.amount)}>
              {operation.quantityDelta === 0 ? 'Sem alteração' : `${sign}${formatQuantity(operation.quantityDelta, unit)}`}
            </p>
            {operation.balanceBefore !== null && operation.balanceAfter !== null && (
              <p className="text-[11px] text-gray-500">{operation.balanceBefore} → {operation.balanceAfter}</p>
            )}
          </div>
          <button type="button" onClick={onOpen} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Abrir registro">
            <ExternalLink size={16} />
          </button>
          {hasDetails && (
            <button type="button" onClick={() => setExpanded((current) => !current)} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Exibir etapas">
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/8 bg-black/15 px-3 py-2.5">
          <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              {operation.events.map((stage) => (
                <div key={stage.id} className="flex items-start gap-2 text-xs">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
                  <span className="font-medium text-gray-300">{movementLabel(stage.event_kind)}</span>
                  <span className="text-gray-500">{stage.description}</span>
                  <span className="ml-auto shrink-0 text-gray-600">{formatDateTime(stage.created_at)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 text-[11px]">
              <DeltaPill label="Novo" value={operation.newDelta} />
              <DeltaPill label="Usado" value={operation.usedDelta} />
              <DeltaPill label="Avaria" value={operation.damagedDelta} />
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

function DeltaPill({ label, value }: { label: string; value: number }) {
  if (value === 0) return null
  return <span className="rounded-md border border-white/8 bg-white/4 px-2 py-1 text-gray-400">{label}: {value > 0 ? '+' : ''}{value}</span>
}
