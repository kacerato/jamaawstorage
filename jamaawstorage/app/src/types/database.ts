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
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "stock_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: [
          {
            foreignKeyName: "stock_item_lots_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "person_inventories_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_inventories_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: [
          {
            foreignKeyName: "withdrawals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_work_site_id_fkey"
            columns: ["work_site_id"]
            isOneToOne: false
            referencedRelation: "work_sites"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: [
          {
            foreignKeyName: "withdrawal_items_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "withdrawals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_items_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_item_lots"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "kits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: [
          {
            foreignKeyName: "kit_items_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kit_items_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: []
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
