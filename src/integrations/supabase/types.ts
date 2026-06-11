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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assessment: {
        Row: {
          data: Json
          id: string
          site_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          data?: Json
          id?: string
          site_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          data?: Json
          id?: string
          site_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      commissioning: {
        Row: {
          data: Json
          id: string
          site_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          data?: Json
          id?: string
          site_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          data?: Json
          id?: string
          site_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commissioning_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          designation: string | null
          email: string | null
          id: string
          mobile: string | null
          name: string | null
          site_id: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          designation?: string | null
          email?: string | null
          id?: string
          mobile?: string | null
          name?: string | null
          site_id: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          designation?: string | null
          email?: string | null
          id?: string
          mobile?: string | null
          name?: string | null
          site_id?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string
          created_by: string | null
          field_type: string
          id: string
          label: string
          options: Json | null
          phase: string
          section: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field_type: string
          id?: string
          label: string
          options?: Json | null
          phase: string
          section: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field_type?: string
          id?: string
          label?: string
          options?: Json | null
          phase?: string
          section?: string
        }
        Relationships: []
      }
      installation: {
        Row: {
          data: Json
          id: string
          site_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          data?: Json
          id?: string
          site_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          data?: Json
          id?: string
          site_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installation_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      machines: {
        Row: {
          brand: string | null
          condition: string | null
          created_at: string
          id: string
          model: string | null
          name: string | null
          serial: string | null
          site_id: string
          year: number | null
        }
        Insert: {
          brand?: string | null
          condition?: string | null
          created_at?: string
          id?: string
          model?: string | null
          name?: string | null
          serial?: string | null
          site_id: string
          year?: number | null
        }
        Update: {
          brand?: string | null
          condition?: string | null
          created_at?: string
          id?: string
          model?: string | null
          name?: string | null
          serial?: string | null
          site_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "machines_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          caption: string | null
          created_at: string
          file_name: string | null
          file_path: string
          file_type: string | null
          id: string
          phase: string
          section: string | null
          site_id: string
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          file_name?: string | null
          file_path: string
          file_type?: string | null
          id?: string
          phase: string
          section?: string | null
          site_id: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string
          file_type?: string | null
          id?: string
          phase?: string
          section?: string | null
          site_id?: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
       profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          last_login: string | null
          mobile: string | null
          name: string | null
          whatsapp: string | null
          status: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          is_active?: boolean
          last_login?: string | null
          mobile?: string | null
          name?: string | null
          whatsapp?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          last_login?: string | null
          mobile?: string | null
          name?: string | null
          whatsapp?: string | null
          status?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          company_name: string | null
          default_cities: Json | null
          id: number
          logo_path: string | null
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          default_cities?: Json | null
          id?: number
          logo_path?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          default_cities?: Json | null
          id?: number
          logo_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sites: {
        Row: {
          address: string | null
          appt_date: string | null
          appt_time: string | null
          assigned_at: string | null
          assigned_worker_id: string | null
          city: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          state: string | null
          task_assigned_at: string | null
          task_assigned_by: string | null
          task_notes: string | null
        }
        Insert: {
          address?: string | null
          appt_date?: string | null
          appt_time?: string | null
          assigned_at?: string | null
          assigned_worker_id?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          state?: string | null
          task_assigned_at?: string | null
          task_assigned_by?: string | null
          task_notes?: string | null
        }
        Update: {
          address?: string | null
          appt_date?: string | null
          appt_time?: string | null
          assigned_at?: string | null
          assigned_worker_id?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          state?: string | null
          task_assigned_at?: string | null
          task_assigned_by?: string | null
          task_notes?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_site: { Args: { _site_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "worker" | "supervisor" | "owner"
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
    Enums: {
      app_role: ["worker", "supervisor", "owner"],
    },
  },
} as const
