export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type QuestKind = "main" | "subquest";
export type EvidenceType = "note" | "url" | "file" | "metric";
export type XpSource =
  | "quest_completion"
  | "daily_mission"
  | "habit"
  | "milestone"
  | "bonus"
  | "achievement";
export type MissionStatus = "planned" | "active" | "completed" | "skipped" | "blocked";
export type MissionPriority = "urgent" | "high" | "normal" | "low";
export type ProgressStatus = "not_started" | "in_progress" | "done";

/**
 * Shapes of the objects Supabase returns. Kept hand-written (rather than generated)
 * so the queries in src/lib/queries.ts are type-checked against the migrations.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string | null; time_zone: string; created_at: string; updated_at: string };
        Insert: { id: string; display_name?: string | null; time_zone?: string };
        Update: { display_name?: string | null; time_zone?: string };
        Relationships: [];
      };
      quests: {
        Row: {
          id: string;
          user_id: string;
          parent_quest_id: string | null;
          title: string;
          kind: QuestKind;
          due_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          parent_quest_id?: string | null;
          title: string;
          kind?: QuestKind;
          due_date?: string | null;
        };
        Update: { title?: string; due_date?: string | null };
        Relationships: [];
      };
      quest_steps: {
        Row: {
          id: string;
          quest_id: string;
          title: string;
          position: number;
          completed_at: string | null;
          evidence_type: EvidenceType | null;
          evidence_value: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          quest_id: string;
          title: string;
          position: number;
          completed_at?: string | null;
          evidence_type?: EvidenceType | null;
          evidence_value?: string | null;
        };
        Update: {
          title?: string;
          position?: number;
          completed_at?: string | null;
          evidence_type?: EvidenceType | null;
          evidence_value?: string | null;
        };
        Relationships: [];
      };
      xp_ledger: {
        Row: {
          id: string;
          user_id: string;
          source: XpSource;
          source_id: string;
          amount: number;
          note: string | null;
          awarded_at: string;
          reversal_of: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      daily_missions: {
        Row: {
          id: string;
          user_id: string;
          mission_date: string;
          title: string;
          notes: string | null;
          priority: MissionPriority;
          estimate_minutes: number | null;
          success_criteria: string | null;
          quest_id: string | null;
          status: MissionStatus;
          position: number;
          completed_at: string | null;
          outcome: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          mission_date: string;
          title: string;
          notes?: string | null;
          priority?: MissionPriority;
          estimate_minutes?: number | null;
          success_criteria?: string | null;
          quest_id?: string | null;
          status?: MissionStatus;
          position?: number;
        };
        Update: {
          title?: string;
          priority?: MissionPriority;
          estimate_minutes?: number | null;
          success_criteria?: string | null;
          notes?: string | null;
          mission_date?: string;
          position?: number;
        };
        Relationships: [];
      };
      habits: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          category: string | null;
          schedule_weekdays: number[] | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          name: string;
          category?: string | null;
          schedule_weekdays?: number[] | null;
          archived_at?: string | null;
        };
        Update: {
          name?: string;
          category?: string | null;
          schedule_weekdays?: number[] | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      habit_logs: {
        Row: {
          id: string;
          habit_id: string;
          log_date: string;
          completed: boolean;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      achievements: {
        Row: { id: string; title: string; description: string; xp: number; sort_order: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      player_achievements: {
        Row: { user_id: string; achievement_id: string; unlocked_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      quest_progress: {
        Row: {
          id: string;
          user_id: string;
          parent_quest_id: string | null;
          title: string;
          kind: QuestKind;
          due_date: string | null;
          created_at: string;
          updated_at: string;
          progress_percent: number;
          status: ProgressStatus;
        };
        Relationships: [];
      };
      player_stats: {
        Row: {
          user_id: string;
          total_xp: number;
          level: number;
          current_level_floor_xp: number;
          xp_into_level: number;
          xp_for_next_level: number;
          xp_to_next_level: number;
          quests_completed: number;
          subquests_completed: number;
          missions_completed: number;
          missions_skipped: number;
          missions_blocked: number;
          habits_logged: number;
          steps_completed: number;
        };
        Relationships: [];
      };
      level_history: {
        Row: {
          event_id: string;
          user_id: string;
          source: XpSource;
          source_id: string;
          amount: number;
          awarded_at: string;
          lifetime_xp_after: number;
          level_after: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      complete_quest_step: {
        Args: { p_step_id: string; p_evidence_type: EvidenceType; p_evidence_value: string };
        Returns: { step_id: string; completed_at: string; xp_awarded: boolean }[];
      };
      create_mission: {
        Args: {
          p_mission_date: string;
          p_title: string;
          p_priority?: MissionPriority;
          p_estimate_minutes?: number | null;
          p_success_criteria?: string | null;
          p_quest_id?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      set_mission_status: {
        Args: { p_mission_id: string; p_status: MissionStatus; p_outcome?: string | null };
        Returns: boolean;
      };
      reopen_mission: { Args: { p_mission_id: string }; Returns: boolean };
      log_habit: {
        Args: { p_habit_id: string; p_log_date: string; p_completed: boolean; p_note?: string | null };
        Returns: { log_id: string; completed: boolean; xp_delta: number }[];
      };
      habit_summary: {
        Args: { p_today: string };
        Returns: {
          habit_id: string;
          name: string;
          category: string | null;
          schedule_weekdays: number[] | null;
          total_completed: number;
          current_streak: number;
          longest_streak: number;
        }[];
      };
      sync_achievements: {
        Args: Record<string, never>;
        Returns: { unlocked_achievement_id: string; xp_awarded: number }[];
      };
      set_time_zone: { Args: { p_time_zone: string }; Returns: string };
    };
    Enums: {
      quest_kind: QuestKind;
      evidence_type: EvidenceType;
      xp_source: XpSource;
      mission_status: MissionStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];
