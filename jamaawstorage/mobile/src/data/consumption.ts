import type { StockEventKind, StockItemRow, StockMovementEventRow } from './database.types'

/**
 * Consumo e previsao de ruptura.
 *
 * Modulo isolado de proposito: a sessao de Relatorios do web esta calculando
 * a mesma coisa. Se aquela regra for extraida para um pacote compartilhado,
 * troca-se este arquivo inteiro sem tocar nas telas.
 *
 * As constantes abaixo nao sao arbitrarias. Vem da medicao no banco real
 * (ver side-session-notes/relatorios-consumo-achados-banco.md):
 *
 * - Janela de 90 dias, nao 30. Houve devolucao em massa em 2026-11-03 que,
 *   em 30 dias, deixa 12 itens com consumo liquido NEGATIVO. Previsao sobre
 *   isso seria lixo.
 * - Piso de historico: abaixo de 3 dias distintos de saida ou 2 unidades,
 *   a taxa diaria nao tem significado (pilhas, WD-40 e fita isolante tem
 *   1 unico dia de saida em 90).
 * - Consumivel x duravel pelo percentual de devolucao: consumivel volta
 *   0-1% (bobina, arame, luva de vaqueta), duravel volta 7-40% (alicate,
 *   cinto, bota). Para duravel, "quando vai acabar" e a pergunta errada:
 *   o item circula e volta.
 * - Backtest: para consumivel de alto volume o erro fica abaixo de 10%;
 *   para item de baixo volume oscila mais de 70%. Por isso a previsao e
 *   faixa, nao ponto, e a taxa aparece junto da data.
 */

export const WINDOW_DAYS = 90
const MIN_DISTINCT_DAYS = 3
const MIN_TOTAL_UNITS = 2
/** Acima disso o item circula e volta: previsao de ruptura nao se aplica. */
const DURABLE_RETURN_RATIO = 0.05

/** Eventos que reduzem o saldo. */
const OUTFLOW: StockEventKind[] = ['exit']
/**
 * Eventos que devolvem ao saldo. 'received' e 'triage' tem delta 0 por
 * construcao: o estoque so e creditado no fim do fluxo de devolucao.
 */
const INFLOW_BACK: StockEventKind[] = ['return', 'restoration']

export type ConsumptionClass =
  /** Consumivel com historico suficiente: previsao de ruptura e honesta. */
  | 'consumable'
  /** Circula e volta: previsao de ruptura nao se aplica. */
  | 'durable'
  /** Historico insuficiente na janela para calcular taxa. */
  | 'insufficient'
  /** Sem nenhuma saida na janela. Nao e "dura para sempre", e "sem movimento". */
  | 'idle'

export interface ItemConsumption {
  item: StockItemRow
  /** Unidades que sairam na janela. */
  outflow: number
  /** Unidades que voltaram (devolucao triada + estorno). */
  returned: number
  /** outflow - returned. A conta que importa. */
  net: number
  /** Dias distintos com saida. Mede regularidade, nao volume. */
  distinctDays: number
  returnRatio: number
  classification: ConsumptionClass
  /** Unidades por dia, so quando a classificacao permite. */
  dailyRate: number | null
  /** Dias ate cruzar o minimo. Negativo = ja esta abaixo. */
  daysToMinimum: number | null
  /** Dias ate chegar a zero. */
  daysToZero: number | null
  /** Saldo atual ja esta no minimo ou abaixo. */
  belowMinimum: boolean
  /** Saldo zerado. Nao e previsao, e fato. */
  depleted: boolean
}

/**
 * Agrega os eventos da janela por item e classifica cada um.
 *
 * `events` deve conter apenas eventos dentro da janela; o filtro de data
 * fica na consulta, para nao trazer o ledger inteiro pela rede.
 */
export function computeConsumption(
  items: StockItemRow[],
  events: StockMovementEventRow[],
): ItemConsumption[] {
  const byItem = new Map<string, { outflow: number; returned: number; days: Set<string> }>()

  for (const event of events) {
    let bucket = byItem.get(event.stock_item_id)
    if (!bucket) {
      bucket = { outflow: 0, returned: 0, days: new Set() }
      byItem.set(event.stock_item_id, bucket)
    }

    if (OUTFLOW.includes(event.event_kind)) {
      // quantity_delta e assinado: saida vem negativa.
      bucket.outflow += Math.abs(event.quantity_delta)
      bucket.days.add(event.created_at.slice(0, 10))
    } else if (INFLOW_BACK.includes(event.event_kind)) {
      bucket.returned += event.quantity_delta
    }
  }

  return items.map((item) => {
    const bucket = byItem.get(item.id)
    const outflow = bucket?.outflow ?? 0
    const returned = bucket?.returned ?? 0
    const net = outflow - returned
    const distinctDays = bucket?.days.size ?? 0
    const returnRatio = outflow > 0 ? returned / outflow : 0

    const depleted = item.current_quantity <= 0
    const belowMinimum = item.current_quantity <= item.minimum_quantity

    const classification = classify({ outflow, net, distinctDays, returnRatio })

    let dailyRate: number | null = null
    let daysToMinimum: number | null = null
    let daysToZero: number | null = null

    if (classification === 'consumable') {
      dailyRate = net / WINDOW_DAYS
      if (dailyRate > 0) {
        daysToMinimum = (item.current_quantity - item.minimum_quantity) / dailyRate
        daysToZero = item.current_quantity / dailyRate
      }
    }

    return {
      item,
      outflow,
      returned,
      net,
      distinctDays,
      returnRatio,
      classification,
      dailyRate,
      daysToMinimum,
      daysToZero,
      belowMinimum,
      depleted,
    }
  })
}

function classify(input: {
  outflow: number
  net: number
  distinctDays: number
  returnRatio: number
}): ConsumptionClass {
  if (input.outflow <= 0) return 'idle'
  if (input.returnRatio > DURABLE_RETURN_RATIO) return 'durable'
  if (input.distinctDays < MIN_DISTINCT_DAYS || input.net < MIN_TOTAL_UNITS) {
    return 'insufficient'
  }
  return 'consumable'
}

export type Urgency = 'crit' | 'warn' | 'ok'

/**
 * Horizonte de aviso, em dias.
 *
 * 21 dias, nao 14: medido no banco, o arame de espinar (40 em estoque,
 * minimo 20, 6,6 un/semana) cruza o minimo em ~3 semanas. Com 14 dias ele
 * aparecia como "ok" ate faltar menos de duas semanas, o que nao da tempo
 * de cotar e receber.
 */
const WARN_HORIZON_DAYS = 21

/**
 * Severidade de reposicao. Fato vence previsao:
 * saldo zero e critico mesmo sem taxa calculada.
 */
export function repositionUrgency(row: ItemConsumption): Urgency {
  if (row.depleted) return 'crit'
  if (row.belowMinimum) return 'crit'
  if (row.daysToMinimum != null && row.daysToMinimum <= WARN_HORIZON_DAYS) return 'warn'
  return 'ok'
}

/**
 * Ordena pelo que o supervisor precisa decidir primeiro:
 * critico antes, e dentro do mesmo nivel o que cruza o minimo mais cedo.
 */
export function sortByUrgency(rows: ItemConsumption[]): ItemConsumption[] {
  const weight: Record<Urgency, number> = { crit: 0, warn: 1, ok: 2 }

  return [...rows].sort((left, right) => {
    const byUrgency = weight[repositionUrgency(left)] - weight[repositionUrgency(right)]
    if (byUrgency !== 0) return byUrgency

    const leftDays = left.daysToMinimum ?? Number.POSITIVE_INFINITY
    const rightDays = right.daysToMinimum ?? Number.POSITIVE_INFINITY
    if (leftDays !== rightDays) return leftDays - rightDays

    return right.net - left.net
  })
}

/** Quanto comprar para voltar ao minimo com folga de 30 dias de consumo. */
export function suggestedPurchase(row: ItemConsumption): number | null {
  if (row.dailyRate == null || row.dailyRate <= 0) {
    // Sem taxa: so repor ate o minimo, se estiver abaixo.
    return row.belowMinimum
      ? Math.max(row.item.minimum_quantity - row.item.current_quantity, 1)
      : null
  }

  const target = row.item.minimum_quantity + row.dailyRate * 30
  const gap = target - row.item.current_quantity

  return gap > 0 ? Math.ceil(gap) : null
}

/** Taxa em unidade legivel. Semana quando da pelo menos 1, senao mes. */
export function formatRate(dailyRate: number | null): string | null {
  if (dailyRate == null || dailyRate <= 0) return null

  const weekly = dailyRate * 7
  if (weekly >= 1) return `${weekly.toFixed(weekly >= 10 ? 0 : 1)} un/semana`

  const monthly = dailyRate * 30
  return `${monthly.toFixed(monthly >= 10 ? 0 : 1)} un/mês`
}

/** Horizonte em texto. Faixa, nunca data isolada com ar de precisao. */
export function formatHorizon(days: number | null): string | null {
  if (days == null || !Number.isFinite(days)) return null
  if (days <= 0) return 'já abaixo do mínimo'
  if (days < 7) return `~${Math.round(days)} dias`
  if (days < 60) return `~${Math.round(days / 7)} semanas`
  if (days < 400) return `~${Math.round(days / 30)} meses`
  return 'mais de um ano'
}

export const CLASS_LABEL: Record<ConsumptionClass, string> = {
  consumable: 'Consumível',
  durable: 'Circula e volta',
  insufficient: 'Histórico curto',
  idle: 'Sem saída',
}
