import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { StockItemCondition, StockReturnStatus, Tables } from '../../types/database'
import { formatDateTime, formatQuantity, openReturnReceiptDocument } from '../../lib/utils'
import { Alert, Badge, Button, Card, Input, SectionLabel, Spinner } from '../../components/ui'
import { PackageIcon } from '../../components/icons'
import { ItemVisual } from '../../components/items/ItemVisual'

type StockReturnRow = Tables<'stock_returns'>
type StockItemRow = Tables<'stock_items'>

interface ReturnItemDetail {
  id: string
  quantity: number
  reportedCondition: StockItemCondition
  notes: string | null
  stockItem: Pick<StockItemRow, 'id' | 'code' | 'name' | 'unit' | 'svg_icon_key'> | null
  conditions: Partial<Record<StockItemCondition, number>>
}

interface ReturnDetail extends StockReturnRow {
  source_person: { id: string; full_name: string; employee_id: string | null } | null
  source_work_site: { id: string; name: string } | null
  received_by_profile: { id: string; full_name: string } | null
  items: ReturnItemDetail[]
}

const STATUS_META: Record<StockReturnStatus, { label: string; variant: 'default' | 'warning' | 'info' | 'success' | 'danger' }> = {
  draft: { label: 'Rascunho', variant: 'default' },
  awaiting_triage: { label: 'Aguardando triagem', variant: 'warning' },
  triaged: { label: 'Triada', variant: 'info' },
  completed: { label: 'Concluída', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'danger' },
}

const CONDITION_LABELS: Record<StockItemCondition, string> = {
  new: 'Novo',
  used: 'Usado',
  damaged: 'Avariado',
}

const REASON_LABELS: Record<string, string> = {
  general: 'Devolução avulsa',
  termination: 'Desligamento do colaborador',
  work_site_closure: 'Encerramento de obra',
  exchange: 'Troca de material',
}

const STEPS: { status: StockReturnStatus; label: string }[] = [
  { status: 'draft', label: 'Seleção' },
  { status: 'awaiting_triage', label: 'Recebimento' },
  { status: 'triaged', label: 'Triagem' },
  { status: 'completed', label: 'Estoque' },
]

export function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<ReturnDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [triageNotes, setTriageNotes] = useState('')

  // Rascunho da triagem: quantidade por item e condição, antes de gravar.
  const [triage, setTriage] = useState<Record<string, Partial<Record<StockItemCondition, string>>>>({})

  const fetchDetail = useCallback(async () => {
    if (!id) return

    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('stock_returns')
      .select(`
        *,
        source_person:people!stock_returns_source_person_id_fkey(id, full_name, employee_id),
        source_work_site:work_sites!stock_returns_source_work_site_id_fkey(id, name),
        received_by_profile:profiles!stock_returns_received_by_fkey(id, full_name),
        stock_return_items(
          id, quantity, reported_condition, notes,
          stock_items(id, code, name, unit, svg_icon_key),
          stock_return_item_conditions(condition, quantity)
        )
      `)
      .eq('id', id)
      .single()

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const raw = data as unknown as StockReturnRow & {
      source_person: ReturnDetail['source_person']
      source_work_site: ReturnDetail['source_work_site']
      received_by_profile: ReturnDetail['received_by_profile']
      stock_return_items: {
        id: string
        quantity: number
        reported_condition: StockItemCondition
        notes: string | null
        stock_items: ReturnItemDetail['stockItem']
        stock_return_item_conditions: { condition: StockItemCondition; quantity: number }[]
      }[]
    }

    const items: ReturnItemDetail[] = (raw.stock_return_items ?? []).map((item) => ({
      id: item.id,
      quantity: item.quantity,
      reportedCondition: item.reported_condition,
      notes: item.notes,
      stockItem: item.stock_items,
      conditions: Object.fromEntries(
        (item.stock_return_item_conditions ?? []).map((entry) => [entry.condition, entry.quantity]),
      ),
    }))

    setDetail({
      ...raw,
      source_person: raw.source_person,
      source_work_site: raw.source_work_site,
      received_by_profile: raw.received_by_profile,
      items,
    })

    // Pré-preenche a triagem com o estado declarado na chegada: o caso comum é
    // confirmar o que foi informado, não redistribuir tudo.
    setTriage(
      Object.fromEntries(
        items.map((item) => {
          const persisted = Object.entries(item.conditions)
          if (persisted.length > 0) {
            return [item.id, Object.fromEntries(persisted.map(([key, value]) => [key, String(value)]))]
          }
          return [item.id, { [item.reportedCondition]: String(item.quantity) }]
        }),
      ),
    )
    setTriageNotes(raw.triage_notes ?? '')
    setLoading(false)
  }, [id])

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

  const sourceLabel = useMemo(() => {
    if (!detail) return ''
    return (
      detail.source_label_snapshot
      ?? detail.source_person?.full_name
      ?? detail.source_work_site?.name
      ?? 'Origem não informada'
    )
  }, [detail])

  const triageTotals = useMemo(() => {
    if (!detail) return {}
    return Object.fromEntries(
      detail.items.map((item) => {
        const entry = triage[item.id] ?? {}
        const total = (['new', 'used', 'damaged'] as StockItemCondition[]).reduce(
          (sum, condition) => sum + (Number.parseInt(entry[condition] ?? '0', 10) || 0),
          0,
        )
        return [item.id, total]
      }),
    ) as Record<string, number>
  }, [detail, triage])

  const triageIsBalanced = useMemo(() => {
    if (!detail) return false
    return detail.items.every((item) => triageTotals[item.id] === item.quantity)
  }, [detail, triageTotals])

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await fetchDetail()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível concluir a ação.')
    } finally {
      setBusy(false)
    }
  }

  const handleSubmitForTriage = () =>
    runAction(async () => {
      const { data, error: rpcError } = await supabase.rpc('submit_return_for_triage', { p_return_id: id! })
      if (rpcError) throw new Error(rpcError.message)
      if (data) await generateReceipt(data)
    })

  // O termo sai junto do recebimento, mas a falha em gerá-lo não desfaz a etapa:
  // o material já foi recebido, e o PDF pode ser reemitido a qualquer momento.
  const generateReceipt = async (source?: StockReturnRow) => {
    if (!detail) return
    const header = source ?? detail

    try {
      await openReturnReceiptDocument({
        returnCode: header.code ?? 'sem-codigo',
        sourceLabel: header.source_label_snapshot ?? sourceLabel,
        sourceKind: header.source_type,
        reason: header.reason,
        receivedAt: header.received_at ? formatDateTime(header.received_at) : formatDateTime(new Date().toISOString()),
        receivedByName: detail.received_by_profile?.full_name ?? 'Almoxarifado',
        notes: header.notes,
        items: detail.items.map((item) => ({
          code: item.stockItem?.code ?? null,
          name: item.stockItem?.name ?? 'Item removido',
          unit: item.stockItem?.unit ?? 'un',
          quantity: item.quantity,
          reportedCondition: item.reportedCondition,
        })),
      })
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : 'Não foi possível gerar o termo.')
    }
  }

  const handleSaveTriage = () =>
    runAction(async () => {
      const payload = Object.entries(triage).map(([itemId, conditions]) => ({
        stock_return_item_id: itemId,
        conditions: Object.fromEntries(
          Object.entries(conditions)
            .map(([condition, value]) => [condition, Number.parseInt(value ?? '0', 10) || 0])
            .filter(([, value]) => (value as number) > 0),
        ) as Partial<Record<StockItemCondition, number>>,
      }))

      const { error: rpcError } = await supabase.rpc('save_return_triage', {
        p_return_id: id!,
        p_triage: payload,
        p_triage_notes: triageNotes.trim() || null,
      })
      if (rpcError) throw new Error(rpcError.message)
    })

  const handleComplete = () =>
    runAction(async () => {
      const { error: rpcError } = await supabase.rpc('complete_return', { p_return_id: id! })
      if (rpcError) throw new Error(rpcError.message)
    })

  const handleCancel = () => {
    const reason = window.prompt('Motivo do cancelamento (opcional):')
    if (reason === null) return

    void runAction(async () => {
      const { error: rpcError } = await supabase.rpc('cancel_return', {
        p_return_id: id!,
        p_reason: reason || null,
      })
      if (rpcError) throw new Error(rpcError.message)
    })
  }

  const handleDeleteDraft = () => {
    if (!window.confirm('Descartar este rascunho? Nada foi movimentado ainda.')) return

    void runAction(async () => {
      const { error: rpcError } = await supabase.rpc('delete_return_draft', { p_return_id: id! })
      if (rpcError) throw new Error(rpcError.message)
      navigate('/returns')
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!detail) {
    return <Alert variant="danger">{error ?? 'Devolução não encontrada.'}</Alert>
  }

  const status = detail.status
  const currentStepIndex = STEPS.findIndex((step) => step.status === status)
  const isEditable = status === 'awaiting_triage' || status === 'triaged'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white">{detail.code ?? 'Rascunho de devolução'}</h1>
            <Badge variant={STATUS_META[status].variant}>{STATUS_META[status].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {detail.source_type === 'collaborator' ? 'Colaborador' : 'Obra'}: {sourceLabel}
            {' · '}
            {REASON_LABELS[detail.reason] ?? detail.reason}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/returns')}>
          Voltar
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {status !== 'cancelled' && (
        <Card variant="bordered">
          <div className="flex flex-wrap items-center gap-2">
            {STEPS.map((step, index) => {
              const reached = currentStepIndex >= index
              return (
                <div key={step.status} className="flex items-center gap-2">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      reached ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-500'
                    }`}
                  >
                    {index + 1}
                  </div>
                  <span className={reached ? 'text-sm text-white' : 'text-sm text-gray-500'}>{step.label}</span>
                  {index < STEPS.length - 1 && <div className="h-px w-6 bg-gray-700" />}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card variant="bordered">
        <SectionLabel label="Itens" />
        <div className="flex flex-col gap-3">
          {detail.items.map((item) => {
            const entry = triage[item.id] ?? {}
            const total = triageTotals[item.id] ?? 0
            const balanced = total === item.quantity

            return (
              <div key={item.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <ItemVisual iconKey={item.stockItem?.svg_icon_key ?? null} alt={item.stockItem?.name ?? ''} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{item.stockItem?.name ?? 'Item removido'}</p>
                    <p className="font-mono text-xs text-orange-300">{item.stockItem?.code ?? '-'}</p>
                  </div>
                  <Badge variant="primary" size="sm">
                    {formatQuantity(item.quantity, item.stockItem?.unit ?? 'un')}
                  </Badge>
                  <Badge variant="default" size="sm">
                    Declarado: {CONDITION_LABELS[item.reportedCondition]}
                  </Badge>
                </div>

                {isEditable ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {(['new', 'used', 'damaged'] as StockItemCondition[]).map((condition) => (
                      <Input
                        key={condition}
                        label={CONDITION_LABELS[condition]}
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={entry[condition] ?? ''}
                        placeholder="0"
                        onChange={(event) =>
                          setTriage((previous) => ({
                            ...previous,
                            [item.id]: { ...previous[item.id], [condition]: event.target.value },
                          }))
                        }
                      />
                    ))}
                    <p className={`sm:col-span-3 text-xs ${balanced ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {balanced
                        ? 'Classificação fecha com a quantidade recebida.'
                        : `Distribuído ${total} de ${item.quantity}. A soma precisa fechar.`}
                    </p>
                  </div>
                ) : (
                  Object.keys(item.conditions).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {(Object.entries(item.conditions) as [StockItemCondition, number][]).map(([condition, quantity]) => (
                        <Badge key={condition} variant="info" size="sm">
                          {CONDITION_LABELS[condition]}: {quantity}
                        </Badge>
                      ))}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>

        {isEditable && (
          <div className="mt-4">
            <Input
              label="Observações da triagem"
              value={triageNotes}
              onChange={(event) => setTriageNotes(event.target.value)}
              placeholder="Opcional"
            />
          </div>
        )}
      </Card>

      <Card variant="bordered">
        <SectionLabel label="Ações" />
        <div className="flex flex-wrap gap-2">
          {status === 'draft' && (
            <>
              <Button onClick={handleSubmitForTriage} disabled={busy}>
                Confirmar recebimento e gerar termo
              </Button>
              <Button variant="danger" onClick={handleDeleteDraft} disabled={busy}>
                Descartar rascunho
              </Button>
            </>
          )}

          {isEditable && (
            <>
              <Button variant="secondary" onClick={() => void generateReceipt()} disabled={busy}>
                Reemitir termo
              </Button>
              <Button onClick={handleSaveTriage} disabled={busy || !triageIsBalanced}>
                Salvar triagem
              </Button>
            </>
          )}

          {status === 'triaged' && (
            <Button onClick={handleComplete} disabled={busy}>
              Confirmar e devolver ao estoque
            </Button>
          )}

          {status !== 'completed' && status !== 'cancelled' && status !== 'draft' && (
            <Button variant="danger" onClick={handleCancel} disabled={busy}>
              Cancelar devolução
            </Button>
          )}

          {status === 'completed' && (
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <PackageIcon className="h-4 w-4" />
              Material creditado no estoque em {detail.completed_at ? formatDateTime(detail.completed_at) : '-'}.
            </div>
          )}

          {status === 'cancelled' && (
            <div className="text-sm text-red-300">
              Cancelada{detail.cancellation_reason ? `: ${detail.cancellation_reason}` : '.'}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
