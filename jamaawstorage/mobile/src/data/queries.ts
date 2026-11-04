import { supabase } from '../lib/supabase'
import { WINDOW_DAYS } from './consumption'
import type {
  PersonRow,
  StockItemRow,
  StockMovementEventRow,
  VehicleMaintenanceAlertRow,
  VehicleRow,
  VehicleUsageLogRow,
} from './database.types'

/**
 * Consultas do app. Todas somente leitura.
 *
 * O ledger tem 915 linhas hoje e cresce; a consulta de eventos sempre
 * carrega a janela com filtro de data e seleciona apenas as 4 colunas que
 * o calculo usa, para nao gastar a franquia de dados do supervisor.
 */

export interface StockSnapshot {
  items: StockItemRow[]
  events: StockMovementEventRow[]
}

export async function fetchStockSnapshot(): Promise<StockSnapshot> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  const [itemsResult, eventsResult] = await Promise.all([
    supabase
      .from('stock_items')
      .select(
        'id, code, name, unit, category, current_quantity, minimum_quantity, quantity_new, quantity_used, quantity_damaged, is_active',
      )
      .eq('is_active', true)
      .order('name'),

    supabase
      .from('stock_movement_events')
      .select('id, stock_item_id, event_kind, quantity_delta, created_at')
      .gte('created_at', since)
      .in('event_kind', ['exit', 'return', 'restoration']),
  ])

  if (itemsResult.error) throw new Error(itemsResult.error.message)
  if (eventsResult.error) throw new Error(eventsResult.error.message)

  return {
    items: itemsResult.data ?? [],
    events: eventsResult.data ?? [],
  }
}

export interface FleetSnapshot {
  vehicles: VehicleRow[]
  logs: VehicleUsageLogRow[]
  alerts: VehicleMaintenanceAlertRow[]
  people: PersonRow[]
}

export async function fetchFleetSnapshot(): Promise<FleetSnapshot> {
  const [vehiclesResult, logsResult, alertsResult, peopleResult] = await Promise.all([
    supabase
      .from('vehicles')
      .select(
        'id, code, plate, model, color, year, photo_url, is_active, responsible_person_id',
      )
      .eq('is_active', true)
      .order('code'),

    supabase
      .from('vehicle_usage_logs')
      .select(
        'id, vehicle_id, event_type, occurred_at, odometer_km, fuel_level_percent, fuel_liters, fuel_amount, station_name, fuel_bars_filled, fuel_bars_total, notes',
      )
      .order('occurred_at', { ascending: false })
      .limit(100),

    supabase
      .from('vehicle_maintenance_alerts')
      .select(
        'id, vehicle_id, alert_type, title, due_date, due_odometer_km, advance_days, advance_km, status, notes, created_at',
      )
      .neq('status', 'disabled'),

    supabase.from('people').select('id, full_name'),
  ])

  if (vehiclesResult.error) throw new Error(vehiclesResult.error.message)
  if (logsResult.error) throw new Error(logsResult.error.message)
  if (alertsResult.error) throw new Error(alertsResult.error.message)
  if (peopleResult.error) throw new Error(peopleResult.error.message)

  return {
    vehicles: vehiclesResult.data ?? [],
    logs: logsResult.data ?? [],
    alerts: alertsResult.data ?? [],
    people: peopleResult.data ?? [],
  }
}
