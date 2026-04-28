import type { Tables, WithdrawalDestinationType } from './database'

export type { Database, Tables, TablesInsert, TablesUpdate, AppRole, WithdrawalDestinationType } from './database'

export interface PersonWithInventory extends Tables<'people'> {
  inventory: (Tables<'person_inventories'> & {
    stock_items: Tables<'stock_items'>
  })[]
}

export interface WithdrawalWithDetails extends Tables<'withdrawals'> {
  withdrawal_items: (Tables<'withdrawal_items'> & {
    stock_items: Tables<'stock_items'>
  })[]
  requested_by_person: Tables<'people'>
  collaborator?: Tables<'people'> | null
  work_site?: Tables<'work_sites'> | null
  approved_by_profile?: Tables<'profiles'> | null
}

export interface StockItemWithAlerts extends Tables<'stock_items'> {
  is_low_stock: boolean
  lots: Tables<'stock_item_lots'>[]
}

export interface KitWithItems extends Tables<'kits'> {
  kit_items: (Tables<'kit_items'> & {
    stock_items: Tables<'stock_items'>
  })[]
}

export interface DashboardStats {
  total_items: number
  low_stock_count: number
  total_withdrawals_today: number
  active_people_count: number
  total_stock_quantity: number
}

export interface WithdrawalFormData {
  requested_by: string
  destination_type: WithdrawalDestinationType
  collaborator_id?: string | null
  work_site_id?: string | null
  notes?: string
  photo_url?: string | null
  supervisor_signature: string
  requester_signature: string
  witness_signature?: string | null
  items: WithdrawalFormItem[]
}

export interface WithdrawalFormItem {
  stock_item_id: string
  lot_id?: string | null
  quantity: number
  unit: string
}

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'completed'

export interface WithdrawalListItem {
  id: string
  code: string
  requested_by: string
  destination_type: WithdrawalDestinationType
  collaborator_id: string | null
  work_site_id: string | null
  status: WithdrawalStatus
  created_at: string
  supervisor_signature: string | null
  requester_signature: string | null
  requested_by_person: Tables<'people'>
  collaborator: Tables<'people'> | null
  work_site: Tables<'work_sites'> | null
}

export type DateRange = {
  from: Date
  to: Date
}

export type ReportPeriod = 'week' | 'month' | 'quarter' | 'custom'
