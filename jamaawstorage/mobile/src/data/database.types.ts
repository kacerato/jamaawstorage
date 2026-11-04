/**
 * Subconjunto do schema do Supabase, limitado ao que o app mobile le.
 *
 * O web usa src/types/database.ts, gerado inteiro. Aqui o arquivo e manual
 * de proposito: o app le 5 tabelas de 26, e o tipo completo (80KB) tornaria
 * qualquer mudanca de schema um merge gigante por nada.
 *
 * Se o schema mudar, rode no projeto web:
 *   npx supabase gen types typescript --project-id syslxrzvfvdpoiwbpyjd
 * e traga a mao as colunas destas tabelas.
 *
 * Confirmado contra o banco em 2026-11-04.
 */

export type AppRole = 'supervisor' | 'admin'

/** event_kind de stock_movement_events, medido no banco (915 linhas). */
export type StockEventKind =
  | 'entry'
  | 'exit'
  | 'adjustment'
  | 'received'
  | 'return'
  | 'triage'
  | 'reclassification'
  | 'restoration'
  | 'initial_entry'

export type VehicleEventType = 'pickup' | 'dropoff' | 'refuel' | 'odometer' | 'maintenance'

export type MaintenanceAlertType =
  | 'oil_change'
  | 'scheduled_review'
  | 'tires'
  | 'brakes'
  | 'document'
  | 'custom'

export type MaintenanceStatus = 'active' | 'completed' | 'disabled'

export interface ProfileRow {
  id: string
  full_name: string
  employee_id: string | null
  role: AppRole
  sector: string | null
  photo_url: string | null
  is_active: boolean
}

export interface StockItemRow {
  id: string
  code: string
  name: string
  unit: string
  category: string | null
  current_quantity: number
  minimum_quantity: number
  quantity_new: number
  quantity_used: number
  quantity_damaged: number
  is_active: boolean
}

export interface StockMovementEventRow {
  id: string
  stock_item_id: string
  event_kind: StockEventKind
  quantity_delta: number
  created_at: string
}

export interface VehicleRow {
  id: string
  code: string
  plate: string | null
  model: string
  color: string | null
  year: number | null
  photo_url: string | null
  is_active: boolean
  responsible_person_id: string | null
}

export interface VehicleUsageLogRow {
  id: string
  vehicle_id: string
  event_type: VehicleEventType
  occurred_at: string
  odometer_km: number | null
  fuel_level_percent: number | null
  fuel_liters: number | null
  fuel_amount: number | null
  station_name: string | null
  fuel_bars_filled: number | null
  fuel_bars_total: number | null
  notes: string | null
}

export interface VehicleMaintenanceAlertRow {
  id: string
  vehicle_id: string
  alert_type: MaintenanceAlertType
  title: string
  due_date: string | null
  due_odometer_km: number | null
  advance_days: number
  advance_km: number
  status: MaintenanceStatus
  notes: string | null
  created_at: string
}

export interface PersonRow {
  id: string
  full_name: string
}

/**
 * Shape minimo que o supabase-js precisa. So as tabelas lidas,
 * todas somente leitura neste app (Insert/Update nunca usados).
 */
export interface Database {
  public: {
    Tables: {
      profiles: { Row: ProfileRow; Insert: never; Update: never; Relationships: [] }
      stock_items: { Row: StockItemRow; Insert: never; Update: never; Relationships: [] }
      stock_movement_events: {
        Row: StockMovementEventRow
        Insert: never
        Update: never
        Relationships: []
      }
      vehicles: { Row: VehicleRow; Insert: never; Update: never; Relationships: [] }
      vehicle_usage_logs: {
        Row: VehicleUsageLogRow
        Insert: never
        Update: never
        Relationships: []
      }
      vehicle_maintenance_alerts: {
        Row: VehicleMaintenanceAlertRow
        Insert: never
        Update: never
        Relationships: []
      }
      people: { Row: PersonRow; Insert: never; Update: never; Relationships: [] }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      app_role: AppRole
    }
    CompositeTypes: Record<string, never>
  }
}
