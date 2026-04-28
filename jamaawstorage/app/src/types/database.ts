export type AppRole = 'supervisor' | 'leader' | 'collaborator'

export type WithdrawalDestinationType = 'collaborator' | 'work_site'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string
          employee_id: string | null
          role: AppRole
          sector: string | null
          photo_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          employee_id?: string | null
          role?: AppRole
          sector?: string | null
          photo_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          employee_id?: string | null
          role?: AppRole
          sector?: string | null
          photo_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      stock_items: {
        Row: {
          id: string
          code: string
          name: string
          description: string | null
          unit: string
          ca_nr: string | null
          category: string | null
          svg_icon_key: string | null
          current_quantity: number
          minimum_quantity: number
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          description?: string | null
          unit: string
          ca_nr?: string | null
          category?: string | null
          svg_icon_key?: string | null
          current_quantity?: number
          minimum_quantity?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          description?: string | null
          unit?: string
          ca_nr?: string | null
          category?: string | null
          svg_icon_key?: string | null
          current_quantity?: number
          minimum_quantity?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      stock_item_lots: {
        Row: {
          id: string
          stock_item_id: string
          lot_code: string
          quantity: number
          expiry_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          stock_item_id: string
          lot_code: string
          quantity: number
          expiry_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          stock_item_id?: string
          lot_code?: string
          quantity?: number
          expiry_date?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      people: {
        Row: {
          id: string
          full_name: string
          employee_id: string | null
          role: AppRole
          sector: string | null
          photo_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          full_name: string
          employee_id?: string | null
          role?: AppRole
          sector?: string | null
          photo_url?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          employee_id?: string | null
          role?: AppRole
          sector?: string | null
          photo_url?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      person_inventories: {
        Row: {
          id: string
          person_id: string
          stock_item_id: string
          quantity: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          person_id: string
          stock_item_id: string
          quantity: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          person_id?: string
          stock_item_id?: string
          quantity?: number
          created_at?: string
          updated_at?: string
        }
      }
      withdrawals: {
        Row: {
          id: string
          code: string
          authorized_by: string | null
          requested_by: string
          destination_type: WithdrawalDestinationType
          collaborator_id: string | null
          work_site_id: string | null
          status: 'pending' | 'approved' | 'rejected' | 'completed'
          notes: string | null
          photo_url: string | null
          supervisor_signature: string | null
          requester_signature: string | null
          witness_signature: string | null

          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code?: string
          authorized_by?: string | null
          requested_by: string
          destination_type?: WithdrawalDestinationType
          collaborator_id?: string | null
          work_site_id?: string | null
          status?: 'pending' | 'approved' | 'rejected' | 'completed'
          notes?: string | null
          photo_url?: string | null
          supervisor_signature?: string | null
          requester_signature?: string | null
          witness_signature?: string | null

          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          code?: string
          authorized_by?: string | null
          requested_by?: string
          destination_type?: WithdrawalDestinationType
          collaborator_id?: string | null
          work_site_id?: string | null
          status?: 'pending' | 'approved' | 'rejected' | 'completed'
          notes?: string | null
          photo_url?: string | null
          supervisor_signature?: string | null
          requester_signature?: string | null
          witness_signature?: string | null

          created_at?: string
          updated_at?: string
        }
      }
      withdrawal_items: {
        Row: {
          id: string
          withdrawal_id: string
          stock_item_id: string
          lot_id: string | null
          quantity: number
          unit: string
        }
        Insert: {
          id?: string
          withdrawal_id: string
          stock_item_id: string
          lot_id?: string | null
          quantity: number
          unit: string
        }
        Update: {
          id?: string
          withdrawal_id?: string
          stock_item_id?: string
          lot_id?: string | null
          quantity?: number
          unit?: string
        }
      }
      work_sites: {
        Row: {
          id: string
          name: string
          location: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          location?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          location?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
    kits: {
      Row: {
        id: string
        name: string
        description: string | null
        is_active: boolean
        created_by: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id?: string
        name: string
        description?: string | null
        is_active?: boolean
        created_by?: string | null
        created_at?: string
        updated_at?: string
      }
      Update: {
        id?: string
        name?: string
        description?: string | null
        is_active?: boolean
        created_by?: string | null
        created_at?: string
        updated_at?: string
      }
    }
      kit_items: {
        Row: {
          id: string
          kit_id: string
          stock_item_id: string
          quantity: number
          created_at: string
        }
        Insert: {
          id?: string
          kit_id: string
          stock_item_id: string
          quantity: number
          created_at?: string
        }
        Update: {
          id?: string
          kit_id?: string
          stock_item_id?: string
          quantity?: number
          created_at?: string
        }
      }
      audit_logs: {
        Row: {
          id: string
          user_id: string | null
          action: string
          table_name: string
          record_id: string | null
          old_data: Record<string, unknown> | null
          new_data: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          table_name: string
          record_id?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          action?: string
          table_name?: string
          record_id?: string | null
          old_data?: Record<string, unknown> | null
          new_data?: Record<string, unknown> | null
          created_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      check_low_stock: {
        Args: Record<string, never>
        Returns: Database['public']['Tables']['stock_items']['Row'][]
      }
    }
    Enums: {
      app_role: 'supervisor' | 'leader' | 'collaborator'
      withdrawal_status: 'pending' | 'approved' | 'rejected' | 'completed'
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
