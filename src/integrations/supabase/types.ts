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
      admin_actions: {
        Row: {
          action: string
          admin_id: string
          amount: number | null
          created_at: string
          id: string
          note: string | null
          target_user_id: string
        }
        Insert: {
          action: string
          admin_id: string
          amount?: number | null
          created_at?: string
          id?: string
          note?: string | null
          target_user_id: string
        }
        Update: {
          action?: string
          admin_id?: string
          amount?: number | null
          created_at?: string
          id?: string
          note?: string | null
          target_user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          contact_email: string | null
          id: number
          maintenance_mode: boolean
          max_withdrawal: number
          min_deposit: number
          min_withdrawal: number
          mpesa_till: string | null
          referral_percent: number
          site_name: string
          updated_at: string
          whatsapp: string | null
          whatsapp_default_msg: string
          withdrawal_fee_enabled: boolean
          withdrawal_fee_percent: number
          withdrawals_open_override: boolean | null
        }
        Insert: {
          contact_email?: string | null
          id?: number
          maintenance_mode?: boolean
          max_withdrawal?: number
          min_deposit?: number
          min_withdrawal?: number
          mpesa_till?: string | null
          referral_percent?: number
          site_name?: string
          updated_at?: string
          whatsapp?: string | null
          whatsapp_default_msg?: string
          withdrawal_fee_enabled?: boolean
          withdrawal_fee_percent?: number
          withdrawals_open_override?: boolean | null
        }
        Update: {
          contact_email?: string | null
          id?: number
          maintenance_mode?: boolean
          max_withdrawal?: number
          min_deposit?: number
          min_withdrawal?: number
          mpesa_till?: string | null
          referral_percent?: number
          site_name?: string
          updated_at?: string
          whatsapp?: string | null
          whatsapp_default_msg?: string
          withdrawal_fee_enabled?: boolean
          withdrawal_fee_percent?: number
          withdrawals_open_override?: boolean | null
        }
        Relationships: []
      }
      deposits: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          id: string
          mpesa_code: string
          plan_id: string | null
          processed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string
          id?: string
          mpesa_code: string
          plan_id?: string | null
          processed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          id?: string
          mpesa_code?: string
          plan_id?: string | null
          processed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "investment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_plans: {
        Row: {
          amount_presets: number[] | null
          color: string | null
          created_at: string
          daily_return_percent: number
          description: string | null
          duration_days: number
          icon: string | null
          id: string
          is_active: boolean
          max_amount: number | null
          min_amount: number
          name: string
          roi_percent: number
          slug: string
          sort_order: number
          unlock_day: number | null
          updated_at: string
        }
        Insert: {
          amount_presets?: number[] | null
          color?: string | null
          created_at?: string
          daily_return_percent: number
          description?: string | null
          duration_days: number
          icon?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number
          name: string
          roi_percent?: number
          slug: string
          sort_order?: number
          unlock_day?: number | null
          updated_at?: string
        }
        Update: {
          amount_presets?: number[] | null
          color?: string | null
          created_at?: string
          daily_return_percent?: number
          description?: string | null
          duration_days?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number
          name?: string
          roi_percent?: number
          slug?: string
          sort_order?: number
          unlock_day?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      investments: {
        Row: {
          created_at: string
          daily_return: number
          days_paid: number
          duration_days: number
          end_at: string | null
          id: string
          last_claim_at: string | null
          plan_amount: number
          plan_id: string | null
          projected_payout: number | null
          roi_percent: number | null
          start_at: string
          status: string
          unlock_day: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_return: number
          days_paid?: number
          duration_days?: number
          end_at?: string | null
          id?: string
          last_claim_at?: string | null
          plan_amount: number
          plan_id?: string | null
          projected_payout?: number | null
          roi_percent?: number | null
          start_at?: string
          status?: string
          unlock_day?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          daily_return?: number
          days_paid?: number
          duration_days?: number
          end_at?: string | null
          id?: string
          last_claim_at?: string | null
          plan_amount?: number
          plan_id?: string | null
          projected_payout?: number | null
          roi_percent?: number | null
          start_at?: string
          status?: string
          unlock_day?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "investment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          balance: number
          country: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          id: string
          last_login_at: string | null
          phone: string
          referral_code: string | null
          referred_by: string | null
          status: string
          username: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          balance?: number
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id: string
          last_login_at?: string | null
          phone?: string
          referral_code?: string | null
          referred_by?: string | null
          status?: string
          username?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          balance?: number
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          id?: string
          last_login_at?: string | null
          phone?: string
          referral_code?: string | null
          referred_by?: string | null
          status?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_earnings: {
        Row: {
          amount: number
          created_at: string
          deposit_id: string | null
          id: string
          percent: number
          referred_id: string
          referrer_id: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          deposit_id?: string | null
          id?: string
          percent: number
          referred_id: string
          referrer_id: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          deposit_id?: string | null
          id?: string
          percent?: number
          referred_id?: string
          referrer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_earnings_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referred_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          referred_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          referred_id?: string
          referrer_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          reference: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          reference?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          reference?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          id: string
          mpesa_phone: string
          payout_mpesa_code: string | null
          processed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string
          id?: string
          mpesa_phone: string
          payout_mpesa_code?: string | null
          processed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          id?: string
          mpesa_phone?: string
          payout_mpesa_code?: string | null
          processed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_adjust_balance: {
        Args: { _delta: number; _note?: string; _target: string }
        Returns: number
      }
      admin_grant_plan: {
        Args: { _amount: number; _note?: string; _target: string }
        Returns: string
      }
      admin_restore_user: {
        Args: { _note?: string; _target: string }
        Returns: boolean
      }
      admin_set_user_status: {
        Args: { _note?: string; _status: string; _target: string }
        Returns: string
      }
      admin_soft_delete_user: {
        Args: { _note?: string; _target: string }
        Returns: boolean
      }
      claim_earnings: { Args: never; Returns: number }
      gen_referral_code: { Args: never; Returns: string }
      gen_referral_code_from_name: {
        Args: { _full_name: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mature_investments: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
