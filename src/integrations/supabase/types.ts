export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      documents: {
        Row: {
          created_at: string
          file_path: string
          file_size: number
          filename: string
          id: string
          mime_type: string
          updated_at: string
          upload_status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          file_path: string
          file_size: number
          filename: string
          id?: string
          mime_type: string
          updated_at?: string
          upload_status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          file_path?: string
          file_size?: number
          filename?: string
          id?: string
          mime_type?: string
          updated_at?: string
          upload_status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      lead_time_analysis: {
        Row: {
          confidence_level: number | null
          created_at: string
          estimated_lead_time: number
          factors: Json | null
          id: string
          vendor_offer_id: string
        }
        Insert: {
          confidence_level?: number | null
          created_at?: string
          estimated_lead_time: number
          factors?: Json | null
          id?: string
          vendor_offer_id: string
        }
        Update: {
          confidence_level?: number | null
          created_at?: string
          estimated_lead_time?: number
          factors?: Json | null
          id?: string
          vendor_offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_time_analysis_vendor_offer_id_fkey"
            columns: ["vendor_offer_id"]
            isOneToOne: false
            referencedRelation: "vendor_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          created_at: string
          document_id: string
          error_message: string | null
          id: string
          job_status: string
          job_type: string
          progress: number | null
          result_data: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id: string
          error_message?: string | null
          id?: string
          job_status?: string
          job_type?: string
          progress?: number | null
          result_data?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          error_message?: string | null
          id?: string
          job_status?: string
          job_type?: string
          progress?: number | null
          result_data?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_assessments: {
        Row: {
          assessment_data: Json | null
          created_at: string
          id: string
          risk_factors: Json
          risk_score: number
          vendor_offer_id: string
        }
        Insert: {
          assessment_data?: Json | null
          created_at?: string
          id?: string
          risk_factors: Json
          risk_score: number
          vendor_offer_id: string
        }
        Update: {
          assessment_data?: Json | null
          created_at?: string
          id?: string
          risk_factors?: Json
          risk_score?: number
          vendor_offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_assessments_vendor_offer_id_fkey"
            columns: ["vendor_offer_id"]
            isOneToOne: false
            referencedRelation: "vendor_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      tco_calculations: {
        Row: {
          breakdown: Json
          calculated_tco: number
          calculation_method: string | null
          created_at: string
          id: string
          vendor_offer_id: string
        }
        Insert: {
          breakdown: Json
          calculated_tco: number
          calculation_method?: string | null
          created_at?: string
          id?: string
          vendor_offer_id: string
        }
        Update: {
          breakdown?: Json
          calculated_tco?: number
          calculation_method?: string | null
          created_at?: string
          id?: string
          vendor_offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tco_calculations_vendor_offer_id_fkey"
            columns: ["vendor_offer_id"]
            isOneToOne: false
            referencedRelation: "vendor_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_offers: {
        Row: {
          created_at: string
          currency: string
          document_id: string
          extracted_data: Json | null
          id: string
          items_count: number | null
          quoted_price: number
          updated_at: string
          vendor_name: string
        }
        Insert: {
          created_at?: string
          currency?: string
          document_id: string
          extracted_data?: Json | null
          id?: string
          items_count?: number | null
          quoted_price: number
          updated_at?: string
          vendor_name: string
        }
        Update: {
          created_at?: string
          currency?: string
          document_id?: string
          extracted_data?: Json | null
          id?: string
          items_count?: number | null
          quoted_price?: number
          updated_at?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_offers_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
