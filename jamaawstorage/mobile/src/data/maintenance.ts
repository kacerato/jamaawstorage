import type {
  MaintenanceAlertType,
  VehicleMaintenanceAlertRow,
  VehicleUsageLogRow,
} from './database.types'

/**
 * Estado de alerta de manutencao.
 *
 * Portado de app/src/pages/vehicles/VehiclesPage.tsx (maintenanceState).
 * A regra e a mesma de proposito: o app mobile nao pode discordar do site
 * sobre o que esta vencido.
 *
 * Um alerta vence por data OU por quilometragem, o que vier primeiro.
 * `advance_days` e `advance_km` definem quando ele passa a avisar.
 */

export type MaintenanceSeverity = 'overdue' | 'due_soon' | 'ok' | 'done' | 'off'

export interface MaintenanceState {
  severity: MaintenanceSeverity
  label: string
  /** Dias ate a data de vencimento. Negativo = passou. */
  daysLeft: number | null
  /** Km ate o vencimento por odometro. Negativo ou zero = passou. */
  kmLeft: number | null
  /** Ordem de exibicao: vencido primeiro. */
  priority: number
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function maintenanceState(
  alert: VehicleMaintenanceAlertRow,
  currentOdometerKm: number | null,
): MaintenanceState {
  if (alert.status === 'completed') {
    return { severity: 'done', label: 'Concluída', daysLeft: null, kmLeft: null, priority: 4 }
  }
  if (alert.status === 'disabled') {
    return { severity: 'off', label: 'Inativa', daysLeft: null, kmLeft: null, priority: 5 }
  }

  const today = startOfToday()

  const daysLeft = alert.due_date
    ? Math.ceil((new Date(`${alert.due_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
    : null

  const kmLeft =
    alert.due_odometer_km != null && currentOdometerKm != null
      ? alert.due_odometer_km - currentOdometerKm
      : null

  if ((daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft <= 0)) {
    return { severity: 'overdue', label: 'Vencida', daysLeft, kmLeft, priority: 0 }
  }

  if (
    (daysLeft != null && daysLeft <= alert.advance_days) ||
    (kmLeft != null && kmLeft <= alert.advance_km)
  ) {
    return { severity: 'due_soon', label: 'Próxima', daysLeft, kmLeft, priority: 1 }
  }

  return { severity: 'ok', label: 'Em dia', daysLeft, kmLeft, priority: 2 }
}

export function sortAlerts(
  alerts: VehicleMaintenanceAlertRow[],
  currentOdometerKm: number | null,
): VehicleMaintenanceAlertRow[] {
  return [...alerts].sort((left, right) => {
    const byPriority =
      maintenanceState(left, currentOdometerKm).priority -
      maintenanceState(right, currentOdometerKm).priority
    if (byPriority !== 0) return byPriority

    const leftDate = new Date(left.due_date ?? left.created_at).getTime()
    const rightDate = new Date(right.due_date ?? right.created_at).getTime()
    return leftDate - rightDate
  })
}

export const ALERT_TYPE_LABEL: Record<MaintenanceAlertType, string> = {
  oil_change: 'Troca de óleo',
  scheduled_review: 'Revisão programada',
  tires: 'Pneus',
  brakes: 'Freios',
  document: 'Documento',
  custom: 'Alerta',
}

/** Resumo do alvo do alerta: data, km ou ambos. */
export function targetSummary(alert: VehicleMaintenanceAlertRow): string {
  const parts: string[] = []
  if (alert.due_date) parts.push(formatDateOnly(alert.due_date))
  if (alert.due_odometer_km != null) {
    parts.push(`${alert.due_odometer_km.toLocaleString('pt-BR')} km`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'sem alvo definido'
}

export function formatDateOnly(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Odometro atual do veiculo: a maior leitura registrada.
 *
 * Maior, nao a mais recente: um lancamento fora de ordem (o supervisor
 * registra hoje uma leitura de ontem) nao deve fazer o km do carro "voltar",
 * o que marcaria alertas vencidos como em dia de novo.
 */
export function currentOdometer(logs: VehicleUsageLogRow[]): number | null {
  const readings = logs
    .map((log) => log.odometer_km)
    .filter((km): km is number => km != null && Number.isFinite(km))

  return readings.length > 0 ? Math.max(...readings) : null
}

/** Ultimo abastecimento registrado, se houver. */
export function lastRefuel(logs: VehicleUsageLogRow[]): VehicleUsageLogRow | null {
  const refuels = logs
    .filter((log) => log.event_type === 'refuel')
    .sort((left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime())

  return refuels[0] ?? null
}

/** Leitura mais recente de qualquer tipo, para mostrar "atualizado em". */
export function lastReading(logs: VehicleUsageLogRow[]): VehicleUsageLogRow | null {
  const sorted = [...logs].sort(
    (left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime(),
  )
  return sorted[0] ?? null
}

/**
 * Nivel de combustivel em percentual.
 *
 * O banco grava de duas formas: `fuel_level_percent` direto, ou as barras
 * do painel (`fuel_bars_filled` de `fuel_bars_total`), que e o que a leitura
 * por foto produz. Percentual explicito tem precedencia.
 */
export function fuelPercent(log: VehicleUsageLogRow | null): number | null {
  if (!log) return null
  if (log.fuel_level_percent != null) return log.fuel_level_percent

  if (log.fuel_bars_filled != null && log.fuel_bars_total != null && log.fuel_bars_total > 0) {
    return Math.round((log.fuel_bars_filled / log.fuel_bars_total) * 100)
  }

  return null
}
