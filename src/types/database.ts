export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          avatar_url: string | null;
          is_verified: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          name?: string | null;
          avatar_url?: string | null;
          is_verified?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string | null;
          avatar_url?: string | null;
          is_verified?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      accounts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          type: "cash" | "bank" | "credit_card" | "e_wallet" | "investment";
          balance: number;
          currency: string;
          color: string | null;
          icon: string | null;
          is_active: boolean;
          is_savings: boolean;
          interest_rate: number;
          include_in_networth: boolean;
          display_order?: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          type: "cash" | "bank" | "credit_card" | "e_wallet" | "investment";
          balance?: number;
          currency?: string;
          color?: string | null;
          icon?: string | null;
          is_active?: boolean;
          is_savings?: boolean;
          interest_rate?: number;
          include_in_networth?: boolean;
          display_order?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          type?: "cash" | "bank" | "credit_card" | "e_wallet" | "investment";
          balance?: number;
          currency?: string;
          color?: string | null;
          icon?: string | null;
          is_active?: boolean;
          is_savings?: boolean;
          interest_rate?: number;
          include_in_networth?: boolean;
          display_order?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      categories: {
        Row: {
          id: string;
          user_id: string | null;
          name: string;
          type: "income" | "expense";
          color: string | null;
          icon: string | null;
          is_default: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name: string;
          type: "income" | "expense";
          color?: string | null;
          icon?: string | null;
          is_default?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          name?: string;
          type?: "income" | "expense";
          color?: string | null;
          icon?: string | null;
          is_default?: boolean;
          created_at?: string;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      transactions: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          category_id: string | null;
          goal_id: string | null;
          type: "income" | "expense" | "transfer";
          amount: number;
          description: string | null;
          date: string;
          transfer_to_account_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          category_id?: string | null;
          goal_id?: string | null;
          type: "income" | "expense" | "transfer";
          amount: number;
          description?: string | null;
          date: string;
          transfer_to_account_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          account_id?: string;
          category_id?: string | null;
          goal_id?: string | null;
          type?: "income" | "expense" | "transfer";
          amount?: number;
          description?: string | null;
          date?: string;
          transfer_to_account_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      budgets: {
        Row: {
          id: string;
          user_id: string;
          category_id: string;
          amount: number;
          period: "weekly" | "monthly" | "yearly";
          start_date: string;
          end_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          category_id: string;
          amount: number;
          period?: "weekly" | "monthly" | "yearly";
          start_date: string;
          end_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          category_id?: string;
          amount?: number;
          period?: "weekly" | "monthly" | "yearly";
          start_date?: string;
          end_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      goals: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          target_amount: number;
          current_amount: number;
          target_date: string | null;
          color: string | null;
          icon: string | null;
          is_completed: boolean;
          status: "active" | "completed" | "cancelled";
          review_state: "needs_review" | "confirmed";
          completed_at: string | null;
          archived_at: string | null;
          is_priority: boolean;
          category: string;
          allocation_per_cycle: number;
          allocation_frequency: "monthly" | "kinsenas" | string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          target_amount: number;
          current_amount?: number;
          target_date?: string | null;
          color?: string | null;
          icon?: string | null;
          is_completed?: boolean;
          status?: "active" | "completed" | "cancelled";
          review_state?: "needs_review" | "confirmed";
          completed_at?: string | null;
          archived_at?: string | null;
          is_priority?: boolean;
          category?: string;
          allocation_per_cycle?: number;
          allocation_frequency?: "monthly" | "kinsenas" | string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          target_amount?: number;
          current_amount?: number;
          target_date?: string | null;
          color?: string | null;
          icon?: string | null;
          is_completed?: boolean;
          status?: "active" | "completed" | "cancelled";
          review_state?: "needs_review" | "confirmed";
          completed_at?: string | null;
          archived_at?: string | null;
          is_priority?: boolean;
          category?: string;
          allocation_per_cycle?: number;
          allocation_frequency?: "monthly" | "kinsenas" | string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      financial_operations: {
        Row: {
          id: string;
          user_id: string;
          request_id: string;
          command_hash: string;
          command: Json;
          result: Json | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          request_id: string;
          command_hash: string;
          command: Json;
          result?: Json | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          result?: Json | null;
          completed_at?: string | null;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      goal_allocation_events: {
        Row: {
          id: string;
          user_id: string;
          goal_id: string;
          account_id: string;
          operation_id: string;
          kind: "reserve" | "release" | "spend" | "move_in" | "move_out" | "legacy_spent" | "reversal";
          reserved_delta: string | number;
          spent_delta: string | number;
          transaction_id: string | null;
          reversal_of: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          goal_id: string;
          account_id: string;
          operation_id: string;
          kind: "reserve" | "release" | "spend" | "move_in" | "move_out" | "legacy_spent" | "reversal";
          reserved_delta?: string;
          spent_delta?: string;
          transaction_id?: string | null;
          reversal_of?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
      user_preferences: {
        Row: {
          id: string;
          user_id: string;
          currency: string;
          theme: "light" | "dark" | "system";
          language: string;
          notifications_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          currency?: string;
          theme?: "light" | "dark" | "system";
          language?: string;
          notifications_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          currency?: string;
          theme?: "light" | "dark" | "system";
          language?: string;
          notifications_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
      };
    };
    Views: {};
    Functions: {
      goal_finance_snapshot: {
        Args: Record<string, never>;
        Returns: Json;
      };
      goal_finance_apply: {
        Args: { p_request_id: string; p_command: Json; p_quote?: Json | null };
        Returns: Json;
      };
    };
    Enums: {};
  };
}

// Convenience types
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Account = Database["public"]["Tables"]["accounts"]["Row"];
export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
export type Budget = Database["public"]["Tables"]["budgets"]["Row"];
export type Goal = Database["public"]["Tables"]["goals"]["Row"];
export type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
export type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];
export type GoalAllocationEvent = Database["public"]["Tables"]["goal_allocation_events"]["Row"];
export type FinancialOperation = Database["public"]["Tables"]["financial_operations"]["Row"];
export type UserPreference = Database["public"]["Tables"]["user_preferences"]["Row"];
