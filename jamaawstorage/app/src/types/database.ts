export type AppRole = 'supervisor' | 'leader' | 'collaborator'

export type WithdrawalDestinationType = 'collaborator' | 'work_site'
export type StockReturnSourceType = 'collaborator' | 'work_site'
export type StockReturnRequestStatus = 'pending' | 'held' | 'approved' | 'cancelled'
export type StockConditionCategory = 'new' | 'used' | 'damaged'
export type WithdrawalDocumentRequirementStatus = 'pending' | 'attached' | 'rejected' | 'replaced' | 'not_required'
export type WithdrawalPersonDocumentStatus = 'active' | 'replaced' | 'rejected'

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
          quantity_new: number
          quantity_used: number
          quantity_damaged: number
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
          quantity_new?: number
          quantity_used?: number
          quantity_damaged?: number
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
          quantity_new?: number
          quantity_used?: number
          quantity_damaged?: number
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
          item_condition: 'used' | 'damaged'
          approved_condition: 'new' | 'used' | 'damaged' | null
          origin_withdrawal_item_id: string | null
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
          item_condition?: 'used' | 'damaged'
          approved_condition?: 'new' | 'used' | 'damaged' | null
          origin_withdrawal_item_id?: string | null
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
          item_condition?: 'used' | 'damaged'
          approved_condition?: 'new' | 'used' | 'damaged' | null
          origin_withdrawal_item_id?: string | null
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
            foreignKeyName: "stock_return_requests_origin_withdrawal_item_id_fkey"
            columns: ["origin_withdrawal_item_id"]
            isOneToOne: false
            referencedRelation: "withdrawal_items"
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
      stock_return_events: {
        Row: {
          id: string
          return_request_id: string
          event_type: 'received' | 'held_for_triage' | 'returned_to_stock' | 'cancelled'
          quantity: number
          stock_delta: number
          item_condition: 'new' | 'used' | 'damaged' | null
          actor_id: string | null
          details: string | null
          created_at: string
        }
        Insert: {
          id?: string
          return_request_id: string
          event_type: 'received' | 'held_for_triage' | 'returned_to_stock' | 'cancelled'
          quantity: number
          stock_delta: number
          item_condition?: 'new' | 'used' | 'damaged' | null
          actor_id?: string | null
          details?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          return_request_id?: string
          event_type?: 'received' | 'held_for_triage' | 'returned_to_stock' | 'cancelled'
          quantity?: number
          stock_delta?: number
          item_condition?: 'new' | 'used' | 'damaged' | null
          actor_id?: string | null
          details?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_return_events_return_request_id_fkey"
            columns: ["return_request_id"]
            isOneToOne: false
            referencedRelation: "stock_return_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_return_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      stock_movement_events: {
        Row: {
          id: string
          operation_id: string
          transaction_id: number
          stock_item_id: string
          event_kind: 'initial_entry' | 'entry' | 'exit' | 'return' | 'received' | 'triage' | 'restoration' | 'adjustment' | 'reclassification' | 'cancelled'
          source: 'manual' | 'withdrawal' | 'return' | 'import' | 'assistant' | 'system'
          quantity_delta: number
          quantity_new_delta: number
          quantity_used_delta: number
          quantity_damaged_delta: number
          balance_before: number | null
          balance_after: number | null
          quantity_new_before: number | null
          quantity_new_after: number | null
          quantity_used_before: number | null
          quantity_used_after: number | null
          quantity_damaged_before: number | null
          quantity_damaged_after: number | null
          actor_id: string | null
          related_entity_type: string | null
          related_entity_id: string | null
          related_code: string | null
          counterparty_type: string | null
          counterparty_id: string | null
          counterparty_name: string | null
          description: string | null
          metadata: Record<string, unknown>
          provenance: 'live' | 'backfill'
          created_at: string
        }
        Insert: {
          id?: string
          operation_id?: string
          transaction_id?: number
          stock_item_id: string
          event_kind: 'initial_entry' | 'entry' | 'exit' | 'return' | 'received' | 'triage' | 'restoration' | 'adjustment' | 'reclassification' | 'cancelled'
          source?: 'manual' | 'withdrawal' | 'return' | 'import' | 'assistant' | 'system'
          quantity_delta?: number
          quantity_new_delta?: number
          quantity_used_delta?: number
          quantity_damaged_delta?: number
          balance_before?: number | null
          balance_after?: number | null
          quantity_new_before?: number | null
          quantity_new_after?: number | null
          quantity_used_before?: number | null
          quantity_used_after?: number | null
          quantity_damaged_before?: number | null
          quantity_damaged_after?: number | null
          actor_id?: string | null
          related_entity_type?: string | null
          related_entity_id?: string | null
          related_code?: string | null
          counterparty_type?: string | null
          counterparty_id?: string | null
          counterparty_name?: string | null
          description?: string | null
          metadata?: Record<string, unknown>
          provenance?: 'live' | 'backfill'
          created_at?: string
        }
        Update: {
          id?: string
          operation_id?: string
          transaction_id?: number
          stock_item_id?: string
          event_kind?: 'initial_entry' | 'entry' | 'exit' | 'return' | 'received' | 'triage' | 'restoration' | 'adjustment' | 'reclassification' | 'cancelled'
          source?: 'manual' | 'withdrawal' | 'return' | 'import' | 'assistant' | 'system'
          quantity_delta?: number
          quantity_new_delta?: number
          quantity_used_delta?: number
          quantity_damaged_delta?: number
          balance_before?: number | null
          balance_after?: number | null
          quantity_new_before?: number | null
          quantity_new_after?: number | null
          quantity_used_before?: number | null
          quantity_used_after?: number | null
          quantity_damaged_before?: number | null
          quantity_damaged_after?: number | null
          actor_id?: string | null
          related_entity_type?: string | null
          related_entity_id?: string | null
          related_code?: string | null
          counterparty_type?: string | null
          counterparty_id?: string | null
          counterparty_name?: string | null
          description?: string | null
          metadata?: Record<string, unknown>
          provenance?: 'live' | 'backfill'
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movement_events_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      ai_conversations: {
        Row: {
          id: string
          user_id: string
          title: string
          is_archived: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title?: string
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [{
          foreignKeyName: "ai_conversations_user_id_fkey"
          columns: ["user_id"]
          isOneToOne: false
          referencedRelation: "profiles"
          referencedColumns: ["id"]
        }]
      }
      ai_messages: {
        Row: {
          id: string
          conversation_id: string
          user_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          attachments: Record<string, unknown>[]
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          user_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          attachments?: Record<string, unknown>[]
          metadata?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          user_id?: string
          role?: 'user' | 'assistant' | 'system'
          content?: string
          attachments?: Record<string, unknown>[]
          metadata?: Record<string, unknown>
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      ai_action_requests: {
        Row: {
          id: string
          conversation_id: string
          user_id: string
          tool_name: string
          arguments: Record<string, unknown>
          summary: string
          status: 'pending' | 'confirmed' | 'executing' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
          provider_message: Record<string, unknown> | null
          result: Record<string, unknown> | Record<string, unknown>[] | null
          error: string | null
          confirmed_at: string | null
          executed_at: string | null
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          user_id: string
          tool_name: string
          arguments: Record<string, unknown>
          summary: string
          status?: 'pending' | 'confirmed' | 'executing' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
          provider_message?: Record<string, unknown> | null
          result?: Record<string, unknown> | Record<string, unknown>[] | null
          error?: string | null
          confirmed_at?: string | null
          executed_at?: string | null
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          user_id?: string
          tool_name?: string
          arguments?: Record<string, unknown>
          summary?: string
          status?: 'pending' | 'confirmed' | 'executing' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
          provider_message?: Record<string, unknown> | null
          result?: Record<string, unknown> | Record<string, unknown>[] | null
          error?: string | null
          confirmed_at?: string | null
          executed_at?: string | null
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_action_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_action_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      ai_memories: {
        Row: {
          id: string
          user_id: string
          memory_key: string
          memory_type: 'fact' | 'preference' | 'procedure' | 'alias' | 'rule'
          title: string
          content: string
          trigger_terms: string[]
          tags: string[]
          importance: number
          is_pinned: boolean
          is_active: boolean
          source_conversation_id: string | null
          last_accessed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          memory_key: string
          memory_type?: 'fact' | 'preference' | 'procedure' | 'alias' | 'rule'
          title: string
          content: string
          trigger_terms?: string[]
          tags?: string[]
          importance?: number
          is_pinned?: boolean
          is_active?: boolean
          source_conversation_id?: string | null
          last_accessed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          memory_key?: string
          memory_type?: 'fact' | 'preference' | 'procedure' | 'alias' | 'rule'
          title?: string
          content?: string
          trigger_terms?: string[]
          tags?: string[]
          importance?: number
          is_pinned?: boolean
          is_active?: boolean
          source_conversation_id?: string | null
          last_accessed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_memories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_memories_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
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
      photo_urls: string[]
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
      photo_urls?: string[]
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
      photo_urls?: string[]
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
      withdrawal_document_requirements: {
        Row: {
          id: string
          withdrawal_id: string
          person_id: string
          scope_key: string
          destination_type: WithdrawalDestinationType
          collaborator_id: string | null
          work_site_id: string | null
          status: WithdrawalDocumentRequirementStatus
          person_name_snapshot: string
          person_role_snapshot: string
          destination_label_snapshot: string
          due_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          withdrawal_id: string
          person_id: string
          scope_key: string
          destination_type: WithdrawalDestinationType
          collaborator_id?: string | null
          work_site_id?: string | null
          status?: WithdrawalDocumentRequirementStatus
          person_name_snapshot: string
          person_role_snapshot: string
          destination_label_snapshot: string
          due_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          withdrawal_id?: string
          person_id?: string
          scope_key?: string
          destination_type?: WithdrawalDestinationType
          collaborator_id?: string | null
          work_site_id?: string | null
          status?: WithdrawalDocumentRequirementStatus
          person_name_snapshot?: string
          person_role_snapshot?: string
          destination_label_snapshot?: string
          due_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_document_requirements_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "withdrawals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_document_requirements_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          }
        ]
      }
      withdrawal_person_documents: {
        Row: {
          id: string
          requirement_id: string
          withdrawal_id: string
          person_id: string
          version: number
          status: WithdrawalPersonDocumentStatus
          storage_path: string
          file_name: string
          mime_type: string
          file_size: number
          sha256: string | null
          uploaded_by: string
          uploaded_at: string
          rejection_reason: string | null
          rejected_by: string | null
          rejected_at: string | null
          supersedes_document_id: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          requirement_id: string
          withdrawal_id: string
          person_id: string
          version: number
          status?: WithdrawalPersonDocumentStatus
          storage_path: string
          file_name: string
          mime_type?: string
          file_size: number
          sha256?: string | null
          uploaded_by: string
          uploaded_at?: string
          rejection_reason?: string | null
          rejected_by?: string | null
          rejected_at?: string | null
          supersedes_document_id?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          requirement_id?: string
          withdrawal_id?: string
          person_id?: string
          version?: number
          status?: WithdrawalPersonDocumentStatus
          storage_path?: string
          file_name?: string
          mime_type?: string
          file_size?: number
          sha256?: string | null
          uploaded_by?: string
          uploaded_at?: string
          rejection_reason?: string | null
          rejected_by?: string | null
          rejected_at?: string | null
          supersedes_document_id?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_person_documents_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "withdrawal_document_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_person_documents_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "withdrawals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_person_documents_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
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
      destination_type: WithdrawalDestinationType | null
      collaborator_id: string | null
      work_site_id: string | null
      created_at: string
    }
    Insert: {
      id?: string
      withdrawal_id: string
      stock_item_id: string
      lot_id?: string | null
      quantity: number
      unit: string
      destination_type?: WithdrawalDestinationType | null
      collaborator_id?: string | null
      work_site_id?: string | null
      created_at?: string
    }
    Update: {
      id?: string
      withdrawal_id?: string
      stock_item_id?: string
      lot_id?: string | null
      quantity?: number
      unit?: string
      destination_type?: WithdrawalDestinationType | null
      collaborator_id?: string | null
      work_site_id?: string | null
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
    Views: {
      withdrawal_document_summary: {
        Row: {
          withdrawal_id: string | null
          expected_count: number | null
          attached_count: number | null
          pending_count: number | null
          rejected_count: number | null
          document_status: 'pending' | 'partial' | 'complete' | 'rejected' | 'not_required' | null
        }
        Relationships: []
      }
    }
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
  assistant_adjust_stock_item: {
    Args: {
      p_stock_item_id: string
      p_quantity_new_delta: number
      p_quantity_used_delta: number
      p_quantity_damaged_delta: number
      p_reason: string
      p_action_id: string
    }
    Returns: Database['public']['Tables']['stock_items']['Row']
  }
  assistant_create_stock_item: {
    Args: {
      p_name: string
      p_unit: string
      p_category: string | null
      p_minimum_quantity: number
      p_quantity_new: number
      p_quantity_used: number
      p_quantity_damaged: number
      p_description: string | null
      p_ca_nr: string | null
      p_action_id: string
    }
    Returns: Database['public']['Tables']['stock_items']['Row']
  }
  assistant_withdrawal_item_totals: {
    Args: {
      p_query?: string | null
      p_stock_item_id?: string | null
      p_start_at?: string | null
      p_end_at?: string | null
    }
    Returns: {
      stock_item_id: string
      code: string
      name: string
      unit: string
      total_quantity: number
      withdrawal_count: number
      first_withdrawal_at: string
      last_withdrawal_at: string
    }[]
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
      p_quantity_new?: number | null
      p_quantity_used?: number | null
      p_quantity_damaged?: number | null
      p_adjustment_bucket?: 'new' | 'used' | 'damaged'
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
  adjust_inventory_item_quantity: {
    Args: {
      p_person_id: string
      p_stock_item_id: string
      p_next_quantity: number
      p_reason: string
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
      p_approved_condition?: 'new' | 'used' | 'damaged' | null
      p_hold_condition?: 'used' | 'damaged' | null
    }
    Returns: Database['public']['Tables']['stock_return_requests']['Row']
  }
  register_linked_stock_return: {
    Args: {
      p_withdrawal_item_id: string
      p_quantity: number
      p_item_condition?: 'used' | 'damaged'
    }
    Returns: Database['public']['Tables']['stock_return_requests']['Row']
  }
  process_held_stock_return_request: {
    Args: {
      p_request_id: string
      p_approve_quantity: number
      p_hold_quantity: number
      p_triage_notes?: string | null
      p_approved_condition?: 'new' | 'used' | 'damaged' | null
      p_hold_condition?: 'used' | 'damaged' | null
    }
    Returns: Database['public']['Tables']['stock_return_requests']['Row']
  }
  delete_stock_return_request: {
    Args: {
      p_request_id: string
    }
    Returns: void
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
  update_completed_withdrawal: {
    Args: {
      p_withdrawal_id: string
      p_requested_by: string
      p_destination_type: WithdrawalDestinationType
      p_collaborator_id?: string | null
      p_work_site_id?: string | null
      p_notes?: string | null
      p_items?: Record<string, unknown>[]
    }
    Returns: string
  }
  reopen_rejected_withdrawal: {
    Args: {
      p_withdrawal_id: string
    }
    Returns: string
  }
  register_withdrawal_person_document: {
    Args: {
      p_requirement_id: string
      p_storage_path: string
      p_file_name: string
      p_mime_type: string
      p_file_size: number
      p_sha256?: string | null
      p_notes?: string | null
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
