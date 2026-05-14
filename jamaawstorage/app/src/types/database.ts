export type AppRole = 'supervisor' | 'leader' | 'collaborator'

export type WithdrawalDestinationType = 'collaborator' | 'work_site'
export type StockReturnSourceType = 'collaborator' | 'work_site'
export type StockReturnRequestStatus = 'pending' | 'held' | 'approved'

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
          code?: string
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
      stock_return_requests: {
        Row: {
          id: string
          stock_item_id: string
          quantity: number
          approved_quantity: number
          held_quantity: number
          source_type: StockReturnSourceType
          source_person_id: string | null
          source_work_site_id: string | null
          source_details: string | null
          notes: string | null
          photo_url: string | null
          item_photo_url: string | null
          document_url: string | null
          document_name: string | null
          triage_notes: string | null
          status: StockReturnRequestStatus
          created_by: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          stock_item_id: string
          quantity: number
          approved_quantity?: number
          held_quantity?: number
          source_type: StockReturnSourceType
          source_person_id?: string | null
          source_work_site_id?: string | null
          source_details?: string | null
          notes?: string | null
          photo_url?: string | null
          item_photo_url?: string | null
          document_url?: string | null
          document_name?: string | null
          triage_notes?: string | null
          status?: StockReturnRequestStatus
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          stock_item_id?: string
          quantity?: number
          approved_quantity?: number
          held_quantity?: number
          source_type?: StockReturnSourceType
          source_person_id?: string | null
          source_work_site_id?: string | null
          source_details?: string | null
          notes?: string | null
          photo_url?: string | null
          item_photo_url?: string | null
          document_url?: string | null
          document_name?: string | null
          triage_notes?: string | null
          status?: StockReturnRequestStatus
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_return_requests_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_requests_source_person_id_fkey"
            columns: ["source_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_requests_source_work_site_id_fkey"
            columns: ["source_work_site_id"]
            isOneToOne: false
            referencedRelation: "work_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
  people: {
        Row: {
          id: string
          full_name: string
          employee_id: string | null
          profile_id: string | null
          role: AppRole
          job_title: string | null
          sector: string | null
          cpf: string | null
          photo_url: string | null
          document_attachments: Record<string, unknown>[]
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          full_name: string
          employee_id?: string | null
          profile_id?: string | null
          role?: AppRole
          job_title?: string | null
          sector?: string | null
          cpf?: string | null
          photo_url?: string | null
          document_attachments?: Record<string, unknown>[]
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          employee_id?: string | null
          profile_id?: string | null
          role?: AppRole
          job_title?: string | null
          sector?: string | null
          cpf?: string | null
          photo_url?: string | null
          document_attachments?: Record<string, unknown>[]
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
  person_inventories: {
    Row: {
      id: string
      person_id: string
      stock_item_id: string
      quantity: number
      last_withdrawal_id: string | null
      updated_at: string
    }
    Insert: {
      id?: string
      person_id: string
      stock_item_id: string
      quantity: number
      last_withdrawal_id?: string | null
      updated_at?: string
    }
    Update: {
      id?: string
      person_id?: string
      stock_item_id?: string
      quantity?: number
      last_withdrawal_id?: string | null
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
      supervisor_signature_attachment_url: string | null
      supervisor_signature_attachment_name: string | null
      requester_signature: string | null
      requester_signature_attachment_url: string | null
      requester_signature_attachment_name: string | null
      witness_signature: string | null
      withdrawn_at: string | null
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
      supervisor_signature_attachment_url?: string | null
      supervisor_signature_attachment_name?: string | null
      requester_signature?: string | null
      requester_signature_attachment_url?: string | null
      requester_signature_attachment_name?: string | null
      witness_signature?: string | null
      withdrawn_at?: string | null
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
      supervisor_signature_attachment_url?: string | null
      supervisor_signature_attachment_name?: string | null
      requester_signature?: string | null
      requester_signature_attachment_url?: string | null
      requester_signature_attachment_name?: string | null
      witness_signature?: string | null
      withdrawn_at?: string | null
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
      created_at: string
    }
    Insert: {
      id?: string
      withdrawal_id: string
      stock_item_id: string
      lot_id?: string | null
      quantity: number
      unit: string
      created_at?: string
    }
    Update: {
      id?: string
      withdrawal_id?: string
      stock_item_id?: string
      lot_id?: string | null
      quantity?: number
      unit?: string
      created_at?: string
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
      description: string | null
      location: string | null
      is_active: boolean
      created_by: string | null
      created_at: string
      updated_at: string
    }
    Insert: {
      id?: string
      name: string
      description?: string | null
      location?: string | null
      is_active?: boolean
      created_by?: string | null
      created_at?: string
      updated_at?: string
    }
    Update: {
      id?: string
      name?: string
      description?: string | null
      location?: string | null
      is_active?: boolean
      created_by?: string | null
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
  create_supervisor_account: {
    Args: {
      p_email: string
      p_password: string
      p_full_name: string
      p_employee_id?: string | null
      p_sector?: string | null
    }
    Returns: string
  }
  adjust_stock_item_quantity: {
    Args: {
      p_stock_item_id: string
      p_delta: number
    }
    Returns: number
  }
  update_stock_item_details_and_quantity: {
    Args: {
      p_stock_item_id: string
      p_name: string
      p_description?: string | null
      p_category?: string | null
      p_unit?: string | null
      p_ca_nr?: string | null
      p_minimum_quantity?: number
      p_svg_icon_key?: string | null
      p_stock_adjustment?: number
    }
    Returns: number
  }
  assign_inventory_item_to_person: {
    Args: {
      p_person_id: string
      p_stock_item_id: string
      p_quantity: number
    }
    Returns: number
  }
  assign_inventory_items_to_person: {
    Args: {
      p_person_id: string
      p_items: Record<string, unknown>[]
    }
    Returns: number
  }
  remove_inventory_item_from_person: {
    Args: {
      p_person_id: string
      p_stock_item_id: string
      p_quantity: number
      p_destination: string
    }
    Returns: number
  }
  process_stock_return_request: {
    Args: {
      p_request_id: string
      p_approve_quantity: number
      p_hold_quantity: number
      p_triage_notes?: string | null
    }
    Returns: Database['public']['Tables']['stock_return_requests']['Row']
  }
  create_completed_withdrawal: {
    Args: {
      p_requested_by: string
      p_destination_type: WithdrawalDestinationType
      p_collaborator_id?: string | null
      p_work_site_id?: string | null
      p_authorized_by?: string | null
      p_notes?: string | null
      p_photo_url?: string | null
      p_supervisor_signature?: string | null
      p_requester_signature?: string | null
      p_witness_signature?: string | null
      p_items?: Record<string, unknown>[]
    }
    Returns: string
  }
  activate_supervisor_profile: {
    Args: {
      p_user_id: string
      p_full_name: string
      p_employee_id?: string | null
      p_sector?: string | null
    }
    Returns: string
  }
  restore_own_profile_if_missing: {
    Args: Record<string, never>
    Returns: string
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
