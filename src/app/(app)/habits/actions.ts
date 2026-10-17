"use server";

import { revalidateStats, requireUser, runAchievementSweep } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import {
  cleanBoolean,
  cleanHabitCategory,
  cleanHabitName,
  cleanId,
  cleanMissionDate,
  cleanOptionalText,
  cleanWeekdays,
} from "@/lib/input-validation";

/**
 * Habit logging.
 *
 * A habit day is one row per habit per local calendar date. XP follows the row's state
 * through `log_habit`, which is idempotent: logging the same day twice never awards
 * twice, and correcting a day adjusts the ledger rather than rewriting it.
 */

export async function createHabit(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const name = cleanHabitName(formData.get("name"));
    const category = cleanHabitCategory(formData.get("category"));
    const schedule = cleanWeekdays(formData.getAll("weekdays"));

    const { error } = await supabase.from("habits").insert({
      name,
      category,
      schedule_weekdays: schedule,
    });
    if (error) throw new Error(error.message);

    revalidateStats();
    return success(
      schedule ? `“${name}” added for ${schedule.length} day(s) a week.` : `“${name}” added as a daily habit.`,
    );
  } catch (error) {
    return failure(error, "The habit could not be created.");
  }
}

export async function logHabit(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const habitId = cleanId(formData.get("habitId"), "A habit");
    const logDate = cleanMissionDate(formData.get("logDate"), "A habit date");
    const completed = cleanBoolean(formData.get("completed"));
    const note = cleanOptionalText(formData.get("note"), "A note", 2000);

    const { data, error } = await supabase.rpc("log_habit", {
      p_habit_id: habitId,
      p_log_date: logDate,
      p_completed: completed,
      p_note: note,
    });
    if (error) throw new Error(error.message);

    revalidateStats();
    const unlocked = await runAchievementSweep(supabase);
    const delta = data?.[0]?.xp_delta ?? 0;
    const change = delta > 0 ? ` (+${delta} XP)` : delta < 0 ? ` (${delta} XP)` : "";
    return success(
      completed ? `Logged for ${logDate}${change}.` : `Un-logged ${logDate}${change}.`,
      unlocked,
    );
  } catch (error) {
    return failure(error, "The habit log could not be saved.");
  }
}

export async function updateHabit(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const habitId = cleanId(formData.get("habitId"), "A habit");
    const name = cleanHabitName(formData.get("name"));
    const category = cleanHabitCategory(formData.get("category"));
    const schedule = cleanWeekdays(formData.getAll("weekdays"));

    const { error } = await supabase
      .from("habits")
      .update({ name, category, schedule_weekdays: schedule })
      .eq("id", habitId);
    if (error) throw new Error(error.message);

    revalidateStats();
    return success("Habit updated.");
  } catch (error) {
    return failure(error, "The habit could not be updated.");
  }
}

export async function setHabitArchived(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const habitId = cleanId(formData.get("habitId"), "A habit");
    const archived = cleanBoolean(formData.get("archived"));

    // Archiving keeps the history and the XP that was already earned.
    const { error } = await supabase
      .from("habits")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", habitId);
    if (error) throw new Error(error.message);

    revalidateStats();
    return success(archived ? "Habit archived — its history is preserved." : "Habit restored.");
  } catch (error) {
    return failure(error, "The habit could not be updated.");
  }
}
