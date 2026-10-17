import { cache } from "react";
import { toCalendarDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/types/database";

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type PlayerStats = Views<"player_stats">;
export type QuestProgressRow = Views<"quest_progress">;
export type MissionRow = Tables<"daily_missions">;
export type HabitRow = Tables<"habits">;
export type HabitLogRow = Tables<"habit_logs">;
export type LevelHistoryRow = Views<"level_history">;
export type AchievementRow = Tables<"achievements">;
export type QuestStepRow = Tables<"quest_steps">;

export interface HabitSummary {
  habit_id: string;
  name: string;
  category: string | null;
  schedule_weekdays: number[] | null;
  total_completed: number;
  current_streak: number;
  longest_streak: number;
}

/** True when the Supabase environment variables are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export interface SessionContext {
  supabase: SupabaseServerClient;
  userId: string;
  displayName: string | null;
  /** The user's IANA time zone, used for every local calendar date. */
  timeZone: string;
  /** The user's local `YYYY-MM-DD` right now — never the server's UTC date. */
  today: string;
}

/**
 * The one place a page resolves "who is this and what is today for them".
 * Returns `null` when nobody is signed in; throws only when Supabase is missing.
 *
 * Wrapped in React's `cache` so a layout and the page below it share one lookup per
 * request instead of querying the session twice.
 */
export const getSessionContext = cache(async (now: Date = new Date()): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, time_zone")
    .eq("id", user.id)
    .maybeSingle();

  // A profile is created by a database trigger; fall back defensively rather than crashing.
  const timeZone = profile?.time_zone ?? "UTC";
  let today: string;
  try {
    today = toCalendarDate(now, timeZone);
  } catch {
    today = toCalendarDate(now, "UTC");
  }
  return { supabase, userId: user.id, displayName: profile?.display_name ?? null, timeZone, today };
});

export async function getPlayerStats(supabase: SupabaseServerClient): Promise<PlayerStats | null> {
  const { data, error } = await supabase.from("player_stats").select("*").maybeSingle();
  if (error) throw new Error(`Could not load player statistics: ${error.message}`);
  return data;
}

export async function getLevelHistory(
  supabase: SupabaseServerClient,
  limit = 8,
): Promise<LevelHistoryRow[]> {
  const { data, error } = await supabase
    .from("level_history")
    .select("*")
    .order("awarded_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load XP history: ${error.message}`);
  return data ?? [];
}

export async function getMissionsForDate(
  supabase: SupabaseServerClient,
  date: string,
): Promise<MissionRow[]> {
  const { data, error } = await supabase
    .from("daily_missions")
    .select("*")
    .eq("mission_date", date)
    .order("position")
    .order("created_at");
  if (error) throw new Error(`Could not load today's missions: ${error.message}`);
  return data ?? [];
}

export async function getMissionHistory(
  supabase: SupabaseServerClient,
  limit = 30,
): Promise<MissionRow[]> {
  const { data, error } = await supabase
    .from("daily_missions")
    .select("*")
    .order("mission_date", { ascending: false })
    .order("position")
    .limit(limit);
  if (error) throw new Error(`Could not load mission history: ${error.message}`);
  return data ?? [];
}

export async function getMissionsBetween(
  supabase: SupabaseServerClient,
  from: string,
  to: string,
): Promise<MissionRow[]> {
  const { data, error } = await supabase
    .from("daily_missions")
    .select("*")
    .gte("mission_date", from)
    .lte("mission_date", to)
    .order("mission_date");
  if (error) throw new Error(`Could not load missions for this period: ${error.message}`);
  return data ?? [];
}

/** Work that was planned for an earlier day and never resolved. */
export async function getOverdueMissions(
  supabase: SupabaseServerClient,
  today: string,
  limit = 20,
): Promise<MissionRow[]> {
  const { data, error } = await supabase
    .from("daily_missions")
    .select("*")
    .lt("mission_date", today)
    .in("status", ["planned", "active"])
    .order("mission_date")
    .limit(limit);
  if (error) throw new Error(`Could not load overdue missions: ${error.message}`);
  return data ?? [];
}

/** Missions that were explicitly recorded as blocked, newest first. */
export async function getBlockedMissions(
  supabase: SupabaseServerClient,
  limit = 10,
): Promise<MissionRow[]> {
  const { data, error } = await supabase
    .from("daily_missions")
    .select("*")
    .eq("status", "blocked")
    .order("mission_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load blocked missions: ${error.message}`);
  return data ?? [];
}

/** Streaks and completion totals, computed by the database from the real logs. */
export async function getHabitSummaries(
  supabase: SupabaseServerClient,
  today: string,
): Promise<HabitSummary[]> {
  const { data, error } = await supabase.rpc("habit_summary", { p_today: today });
  if (error) throw new Error(`Could not load habits: ${error.message}`);
  return data ?? [];
}

/**
 * One local calendar day, summarised by the database from the stored records.
 * A day with no records is a summary of zeros, not an error.
 */
export interface DaySummary {
  missions_total: number;
  missions_completed: number;
  missions_skipped: number;
  missions_blocked: number;
  missions_open: number;
  habits_expected: number;
  habits_logged: number;
  xp_awarded: number;
  xp_adjusted: number;
  xp_net: number;
  achievements_unlocked: number;
}

export async function getDaySummary(
  supabase: SupabaseServerClient,
  date: string,
  timeZone: string,
): Promise<DaySummary> {
  const { data, error } = await supabase.rpc("day_summary", { p_date: date, p_time_zone: timeZone });
  if (error) throw new Error(`Could not load the day summary: ${error.message}`);
  const row = (data ?? [])[0];
  if (!row) throw new Error("Could not load the day summary: the database returned no summary row.");
  return row;
}

export async function getHabitLogsBetween(
  supabase: SupabaseServerClient,
  from: string,
  to: string,
): Promise<HabitLogRow[]> {
  const { data, error } = await supabase
    .from("habit_logs")
    .select("*")
    .gte("log_date", from)
    .lte("log_date", to);
  if (error) throw new Error(`Could not load habit logs: ${error.message}`);
  return data ?? [];
}

export async function getActiveHabits(supabase: SupabaseServerClient): Promise<HabitRow[]> {
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .is("archived_at", null)
    .order("created_at");
  if (error) throw new Error(`Could not load habits: ${error.message}`);
  return data ?? [];
}

/**
 * Every habit, archived included. Used where a saved log must be named but the habit
 * it belongs to may since have been archived.
 */
export async function getAllHabits(supabase: SupabaseServerClient): Promise<HabitRow[]> {
  const { data, error } = await supabase.from("habits").select("*").order("created_at");
  if (error) throw new Error(`Could not load habits: ${error.message}`);
  return data ?? [];
}

/** Archived habits: hidden from today's list, but kept so their history and XP remain. */
export async function getArchivedHabits(supabase: SupabaseServerClient): Promise<HabitRow[]> {
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });
  if (error) throw new Error(`Could not load archived habits: ${error.message}`);
  return data ?? [];
}

export interface AchievementWithProgress extends AchievementRow {
  unlockedAt: string | null;
}

export async function getAchievements(supabase: SupabaseServerClient): Promise<AchievementWithProgress[]> {
  const [catalogue, mine] = await Promise.all([
    supabase.from("achievements").select("*").order("sort_order"),
    supabase.from("player_achievements").select("achievement_id, unlocked_at"),
  ]);
  if (catalogue.error) throw new Error(`Could not load achievements: ${catalogue.error.message}`);
  if (mine.error) throw new Error(`Could not load unlocked achievements: ${mine.error.message}`);
  const unlocked = new Map((mine.data ?? []).map((row) => [row.achievement_id, row.unlocked_at]));
  return (catalogue.data ?? []).map((achievement) => ({
    ...achievement,
    unlockedAt: unlocked.get(achievement.id) ?? null,
  }));
}

/** Runs the idempotent achievement sweep and returns the ids unlocked by this call. */
export async function syncAchievements(supabase: SupabaseServerClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("sync_achievements");
  if (error) throw new Error(`Could not check achievements: ${error.message}`);
  return (data ?? []).map((row) => row.unlocked_achievement_id);
}

export async function getQuestOverview(supabase: SupabaseServerClient): Promise<QuestProgressRow[]> {
  const { data, error } = await supabase.from("quest_progress").select("*").order("created_at");
  if (error) throw new Error(`Could not load quests: ${error.message}`);
  return data ?? [];
}

export async function getQuestSteps(supabase: SupabaseServerClient): Promise<QuestStepRow[]> {
  const { data, error } = await supabase.from("quest_steps").select("*").order("position");
  if (error) throw new Error(`Could not load quest steps: ${error.message}`);
  return data ?? [];
}

export function countByStatus(missions: readonly MissionRow[]): Record<string, number> {
  const counts: Record<string, number> = { planned: 0, active: 0, completed: 0, skipped: 0, blocked: 0 };
  for (const mission of missions) counts[mission.status] = (counts[mission.status] ?? 0) + 1;
  return counts;
}
