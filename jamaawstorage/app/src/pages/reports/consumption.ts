import type { Tables } from '../../types/database'

type StockItemRow = Tables<'stock_items'>
type MovementRow = Tables<'stock_movement_events'>

/*
 * Previsao de consumo a partir do ledger `stock_movement_events`.
 *
 * O ledger foi medido no banco antes de escrever isto. Sinais de
 * `quantity_delta`, por `event_kind`:
 *
 *   exit            sempre negativo  - saida por retirada
 *   adjustment      sempre negativo  - ajuste manual (nao e consumo de obra)
 *   entry           sempre positivo  - compra / entrada
 *   initial_entry   sempre positivo  - carga inicial
 *   return          sempre positivo  - triagem concluida, credita estoque
 *   restoration     sempre positivo  - estorno de retirada
 *   received        SEMPRE ZERO      - devolucao recebida, ainda nao triada
 *   triage          SEMPRE ZERO      - etapa intermediaria
 *   reclassification SEMPRE ZERO     - so troca new/used/damaged
 *
 * Os tres de delta zero existem porque o estoque so e creditado no fim da
 * triagem. Somar `quantity_delta` ja os ignora, mas eles ficam listados aqui
 * para que ninguem os inclua por engano numa contagem de eventos.
 */

/* Eventos que representam saida para a operacao. */
const OUTFLOW_KINDS = new Set(['exit'])

/* Eventos que devolvem material ao estoque. */
const INFLOW_KINDS = new Set(['return', 'restoration'])

/*
 * Janela de 90 dias.
 *
 * Nao e arbitraria. Com 30 dias, uma devolucao em massa (como a de 2026-11-03,
 * com 31 eventos de uma vez) deixa 12 itens com consumo liquido NEGATIVO, e a
 * previsao vira ruido. Em 90 dias o mesmo conjunto fica positivo e estavel.
 *
 * O backtest com corte em 2026-08-05 confirmou: para consumivel de volume
 * (arame, luva de vaqueta) o erro contra os 90 dias seguintes ficou abaixo de
 * 10%. Para item de baixo volume passa de 50%, e por isso a estimativa fraca
 * existe como categoria propria em vez de virar data.
 */
export const CONSUMPTION_WINDOW_DAYS = 90

/*
 * Piso de historico. Abaixo disto a taxa diaria nao tem significado: 3 saidas
 * em 6 meses nao definem consumo. O backtest mostrou que esta regra reprova
 * exatamente a cauda cujo consumo real seguinte foi zero ou um.
 */
const MIN_DISTINCT_DAYS = 3
const MIN_NET_QUANTITY = 2

/*
 * Taxa obsoleta. Sem saida no ultimo terco da janela, a media descreve um
 * consumo que ja parou.
 *
 * E o caso da bobina de espinar: media de 10,5/sem vinda de maio-julho, com
 * ultima saida em 15/09. Projetar com essa taxa foi exatamente o erro de 58%
 * que o backtest encontrou. Em 90 dias isto da 30 dias sem saida.
 */
const STALE_RATE_FRACTION = 1 / 3

/*
 * Acima de 5% de devolucao o item circula em vez de ser consumido: sai para a
 * obra e volta. Prever ruptura para ferramenta e errado por construcao, porque
 * a saida nao destroi a unidade. O corte em 5% separa os dois grupos com folga:
 * no banco, consumivel devolve 0-1% (bobina, arame, luva de vaqueta) e duravel
 * devolve 7-40% (alicate 18%, talabarte 15%, chave catraca 23%).
 */
const CIRCULATION_RETURN_RATIO = 0.05

export type ConsumptionNature = 'consumable' | 'circulating'

export type ForecastQuality =
  /* Historico suficiente: data e taxa podem ser exibidas. */
  | 'reliable'
  /* Ha saida, mas pouca: taxa e indicativa, sem data. */
  | 'weak'
  /* Sem saida na janela: nao e "nunca acaba", e "sem consumo medido". */
  | 'no-consumption'

export type StockStatus =
  /* Saldo zero. Nao e previsao, e fato. */
  | 'out'
  /* Saldo no minimo ou abaixo dele, agora. */
  | 'below-minimum'
  /* Vai cruzar o minimo dentro do horizonte de alerta. */
  | 'approaching-minimum'
  | 'ok'

export interface ItemConsumption {
  itemId: string
  name: string
  unit: string
  category: string | null
  currentQuantity: number
  minimumQuantity: number

  /* Saida bruta e devolucao na janela, em unidades. */
  grossOut: number
  returned: number
  /* Saida liquida: grossOut - returned. Pode ser 0, nunca negativa. */
  netConsumption: number
  /* Fracao devolvida, de 0 a 1. Base da classificacao de natureza. */
  returnRatio: number

  /* Dias distintos com saida. Mede regularidade, nao volume. */
  distinctDays: number
  /*
   * Consumo em picos: media semanal mais que o dobro da mediana. Separa
   * "nao tenho dados" de "tenho dados, mas irregulares".
   */
  irregular: boolean
  /*
   * Consumo cessou: nenhuma saida no ultimo terco da janela. A taxa existe,
   * mas descreve o passado.
   */
  stale: boolean
  /* Dias desde a ultima saida. Infinito quando nao houve saida na janela. */
  daysSinceLastOutflow: number
  /* Media sobre a janela inteira, nao sobre os dias com saida. */
  perDay: number
  perWeek: number
  /*
   * Mediana do consumo semanal. Exposta junto da media porque as duas
   * divergindo e o sinal de consumo irregular - o caso da bobina de espinar,
   * que teve pico em maio e caiu depois.
   */
  medianPerWeek: number

  nature: ConsumptionNature
  quality: ForecastQuality

  /* Dias ate o saldo cruzar o minimo. null quando nao ha base para estimar. */
  daysToMinimum: number | null
  /* Dias ate zerar. null quando nao ha base para estimar. */
  daysToEmpty: number | null
  dateToMinimum: Date | null
  dateToEmpty: Date | null

  status: StockStatus
  lastOutflowAt: Date | null
  /*
   * Quanto comprar para cobrir o horizonte pedido mais a folga do minimo.
   * null para item sem consumo medido ou que circula.
   */
  suggestedPurchase: number | null
}

function startOfDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export interface ComputeOptions {
  windowDays?: number
  /* Horizonte de cobertura da sugestao de compra, em dias. */
  coverageDays?: number
  /* Dentro de quantos dias um item "vai cruzar o minimo" ja merece alerta. */
  alertHorizonDays?: number
  now?: Date
}

export function computeConsumption(
  items: StockItemRow[],
  movements: Pick<
    MovementRow,
    'stock_item_id' | 'event_kind' | 'quantity_delta' | 'created_at'
  >[],
  options: ComputeOptions = {},
): ItemConsumption[] {
  const windowDays = options.windowDays ?? CONSUMPTION_WINDOW_DAYS
  const coverageDays = options.coverageDays ?? 60
  const alertHorizonDays = options.alertHorizonDays ?? 30
  const now = options.now ?? new Date()

  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - windowDays)

  interface Bucket {
    grossOut: number
    returned: number
    days: Set<string>
    weeks: Map<number, number>
    lastOutflowAt: Date | null
  }

  const buckets = new Map<string, Bucket>()

  for (const movement of movements) {
    const kind = movement.event_kind
    const isOut = OUTFLOW_KINDS.has(kind)
    const isIn = INFLOW_KINDS.has(kind)
    if (!isOut && !isIn) continue

    const at = new Date(movement.created_at)
    if (Number.isNaN(at.getTime())) continue
    if (at < windowStart || at > now) continue

    let bucket = buckets.get(movement.stock_item_id)
    if (!bucket) {
      bucket = {
        grossOut: 0,
        returned: 0,
        days: new Set(),
        weeks: new Map(),
        lastOutflowAt: null,
      }
      buckets.set(movement.stock_item_id, bucket)
    }

    /*
     * `quantity_delta` ja vem assinado: negativo na saida, positivo na volta.
     * Math.abs mantem a conta correta mesmo se um registro vier com o sinal
     * invertido, em vez de subtrair quando deveria somar.
     */
    const magnitude = Math.abs(movement.quantity_delta)

    if (isOut) {
      bucket.grossOut += magnitude
      bucket.days.add(startOfDayKey(at))
      /* Semana contada do fim para tras, para a mediana semanal. */
      const weekIndex = Math.floor(
        (now.getTime() - at.getTime()) / (7 * 24 * 60 * 60 * 1000),
      )
      bucket.weeks.set(weekIndex, (bucket.weeks.get(weekIndex) ?? 0) + magnitude)
      if (!bucket.lastOutflowAt || at > bucket.lastOutflowAt) {
        bucket.lastOutflowAt = at
      }
    } else {
      bucket.returned += magnitude
    }
  }

  const totalWeeks = Math.max(1, Math.round(windowDays / 7))

  return items.map((item) => {
    const bucket = buckets.get(item.id)
    const grossOut = bucket?.grossOut ?? 0
    const returned = bucket?.returned ?? 0
    /*
     * Piso em zero. Uma devolucao em massa pode superar a saida da janela, e
     * consumo negativo nao existe: significa "sem consumo liquido medido".
     */
    const netConsumption = Math.max(0, grossOut - returned)
    /*
     * Teto em 1. A devolucao da janela pode se referir a uma saida anterior a
     * ela - no banco, a bota-41 devolveu 2 tendo saido 1, o que daria "volta
     * 200%". Acima de 100% o numero deixa de informar e passa a parecer erro,
     * entao o teto diz o que importa: volta praticamente tudo.
     */
    const returnRatio = grossOut > 0 ? Math.min(1, returned / grossOut) : 0
    const distinctDays = bucket?.days.size ?? 0

    const weeklyValues: number[] = []
    for (let week = 0; week < totalWeeks; week += 1) {
      weeklyValues.push(bucket?.weeks.get(week) ?? 0)
    }

    const perDay = netConsumption / windowDays
    const perWeek = perDay * 7
    const medianPerWeek = median(weeklyValues)

    const nature: ConsumptionNature =
      grossOut > 0 && returnRatio > CIRCULATION_RETURN_RATIO
        ? 'circulating'
        : 'consumable'

    /*
     * Consumo concentrado: a media semanal e muito maior que a mediana, ou
     * seja, poucas semanas carregam quase tudo e a maioria ficou em zero.
     *
     * E o caso da bobina de espinar, o maior item do estoque: media 10,5/sem
     * contra mediana 0. O backtest mostrou essa taxa errando 58% para baixo,
     * porque o pico de maio-junho nao se repetiu. Media sobre janela nao
     * descreve esse item, entao a estimativa cai para fraca em vez de virar
     * uma data que nao se cumpre.
     *
     * A regra so se aplica a item que consome na maioria das semanas. Sem
     * isso ela dispara para qualquer item esporadico, porque a mediana de 13
     * semanas e zero sempre que ha semanas vazias: "fita zebrada", com uma
     * unidade no trimestre, seria marcada irregular quando o que falta e
     * historico. Com saida em mais da metade das semanas, mediana zero deixa
     * de ser possivel e a comparacao passa a medir dispersao de verdade.
     */
    const weeksWithOutflow = weeklyValues.filter((value) => value > 0).length
    const isSpiky =
      perWeek > 0 &&
      weeksWithOutflow > totalWeeks / 2 &&
      medianPerWeek * 2 < perWeek

    /*
     * Dias desde a ultima saida. Se passou do limite, a taxa media ficou
     * para tras do que o item faz hoje.
     */
    const lastOutflowAt = bucket?.lastOutflowAt ?? null
    const daysSinceLastOutflow = lastOutflowAt
      ? (now.getTime() - lastOutflowAt.getTime()) / (24 * 60 * 60 * 1000)
      : Number.POSITIVE_INFINITY
    const isStale = daysSinceLastOutflow > windowDays * STALE_RATE_FRACTION

    let quality: ForecastQuality
    if (netConsumption <= 0 || distinctDays === 0) {
      quality = 'no-consumption'
    } else if (
      distinctDays >= MIN_DISTINCT_DAYS &&
      netConsumption >= MIN_NET_QUANTITY &&
      !isSpiky &&
      !isStale
    ) {
      quality = 'reliable'
    } else {
      quality = 'weak'
    }

    const currentQuantity = item.current_quantity ?? 0
    const minimumQuantity = item.minimum_quantity ?? 0

    /*
     * Data so para consumivel com historico suficiente. Item que circula tem
     * taxa de saida mas nao e consumido: a unidade volta, entao projetar
     * ruptura seria inventar um fim que nao ocorre.
     */
    const canForecast =
      quality === 'reliable' && nature === 'consumable' && perDay > 0

    let daysToMinimum: number | null = null
    let daysToEmpty: number | null = null

    if (canForecast) {
      daysToEmpty = Math.max(0, Math.floor(currentQuantity / perDay))
      daysToMinimum = Math.max(
        0,
        Math.floor((currentQuantity - minimumQuantity) / perDay),
      )
    }

    const addDays = (days: number | null): Date | null => {
      if (days === null) return null
      const date = new Date(now)
      date.setDate(date.getDate() + days)
      return date
    }

    let status: StockStatus
    if (currentQuantity <= 0) {
      status = 'out'
    } else if (currentQuantity <= minimumQuantity) {
      status = 'below-minimum'
    } else if (daysToMinimum !== null && daysToMinimum <= alertHorizonDays) {
      status = 'approaching-minimum'
    } else {
      status = 'ok'
    }

    /*
     * Sugestao de compra: cobrir o horizonte e ainda repor a folga ate o
     * minimo. Item que circula fica de fora porque sua reposicao depende do
     * que esta em campo, nao da taxa de saida.
     */
    let suggestedPurchase: number | null = null
    if (nature === 'consumable' && quality === 'reliable' && perDay > 0) {
      /* Base confiavel: cobrir o horizonte e repor a folga ate o minimo. */
      const needed = Math.ceil(
        perDay * coverageDays + minimumQuantity - currentQuantity,
      )
      suggestedPurchase = Math.max(0, needed)
    } else if (
      nature === 'consumable' &&
      minimumQuantity > 0 &&
      currentQuantity < minimumQuantity
    ) {
      /*
       * Sem base para projetar, mas abaixo de um minimo que alguem definiu:
       * repor so a folga, que e um numero vindo da regra e nao da taxa.
       * Item com minimo zero nao entra: "celular alpha W" com uma saida no
       * historico nao gera pedido de compra.
       */
      suggestedPurchase = minimumQuantity - currentQuantity
    }

    return {
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      category: item.category,
      currentQuantity,
      minimumQuantity,
      grossOut,
      returned,
      netConsumption,
      returnRatio,
      distinctDays,
      irregular: isSpiky,
      stale: isStale && netConsumption > 0,
      daysSinceLastOutflow,
      perDay,
      perWeek,
      medianPerWeek,
      nature,
      quality,
      daysToMinimum,
      daysToEmpty,
      dateToMinimum: addDays(daysToMinimum),
      dateToEmpty: addDays(daysToEmpty),
      status,
      lastOutflowAt,
      suggestedPurchase,
    }
  })
}

const STATUS_RANK: Record<StockStatus, number> = {
  out: 0,
  'below-minimum': 1,
  'approaching-minimum': 2,
  ok: 3,
}

/*
 * Ordem da lista de reposicao: o que ja rompeu primeiro, depois o que esta
 * abaixo do minimo, depois o que vai cruzar mais cedo. Dentro do mesmo estado,
 * maior consumo primeiro, porque e o que falta mais rapido.
 */
export function replenishmentList(rows: ItemConsumption[]): ItemConsumption[] {
  return rows
    .filter((row) => row.status !== 'ok')
    .sort((a, b) => {
      const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (byStatus !== 0) return byStatus

      if (a.daysToMinimum !== null && b.daysToMinimum !== null) {
        const byDays = a.daysToMinimum - b.daysToMinimum
        if (byDays !== 0) return byDays
      } else if (a.daysToMinimum !== null) {
        return -1
      } else if (b.daysToMinimum !== null) {
        return 1
      }

      return b.netConsumption - a.netConsumption
    })
}

export interface ConsumptionSummary {
  outCount: number
  belowMinimumCount: number
  approachingCount: number
  /* Itens cuja estimativa nao se sustenta, para nao parecerem "sem risco". */
  weakCount: number
  totalNetConsumption: number
  totalReturned: number
  circulatingCount: number
  trackedCount: number
}

export function summarize(rows: ItemConsumption[]): ConsumptionSummary {
  return {
    outCount: rows.filter((r) => r.status === 'out').length,
    belowMinimumCount: rows.filter((r) => r.status === 'below-minimum').length,
    approachingCount: rows.filter((r) => r.status === 'approaching-minimum')
      .length,
    weakCount: rows.filter((r) => r.quality === 'weak').length,
    totalNetConsumption: rows.reduce((sum, r) => sum + r.netConsumption, 0),
    totalReturned: rows.reduce((sum, r) => sum + r.returned, 0),
    circulatingCount: rows.filter((r) => r.nature === 'circulating').length,
    trackedCount: rows.filter((r) => r.quality === 'reliable').length,
  }
}

/* Texto da previsao. Nunca devolve data quando a base nao sustenta. */
export function forecastLabel(row: ItemConsumption): string {
  if (row.status === 'out') return 'Sem saldo'
  if (row.nature === 'circulating') {
    return `Circula · volta ${Math.round(row.returnRatio * 100)}%`
  }
  /*
   * Estar abaixo do minimo e um fato de agora e vale mais que o motivo de nao
   * haver projecao: quem le precisa ver "abaixo do minimo" antes de
   * "historico insuficiente".
   */
  if (row.status === 'below-minimum' && row.quality !== 'reliable') {
    return 'Abaixo do minimo'
  }
  if (row.quality === 'no-consumption') return 'Sem consumo medido'
  if (row.quality === 'weak') {
    /*
     * Dois motivos diferentes para nao dar data, e o usuario precisa saber
     * qual: a bobina de espinar tem historico de sobra mas consome em picos,
     * enquanto a bota-46 simplesmente nao tem saidas suficientes.
     */
    if (row.stale) {
      const weeks = Math.round(row.daysSinceLastOutflow / 7)
      return `Sem saida ha ${weeks} sem`
    }
    return row.irregular ? 'Consumo irregular' : 'Historico insuficiente'
  }

  if (row.status === 'below-minimum') {
    return row.daysToEmpty !== null ? `Zera em ${row.daysToEmpty} d` : 'Abaixo do minimo'
  }
  if (row.daysToMinimum === null) return 'Sem estimativa'
  if (row.daysToMinimum === 0) return 'Cruza o minimo hoje'
  return `Cruza o minimo em ${row.daysToMinimum} d`
}

export function formatRate(row: ItemConsumption): string {
  if (row.netConsumption <= 0) return '—'
  if (row.perWeek >= 1) {
    return `${row.perWeek.toFixed(1)}/sem`
  }
  return `${row.perDay.toFixed(2)}/dia`
}
