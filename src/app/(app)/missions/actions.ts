"use server";

import { revalidateStats, requireUser, runAchievementSweep } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import {
  cleanId,
  cleanMissionDate,
  cleanMissionPriority,
  cleanMissionStatus,
  cleanMissionTitle,
  cleanOptionalMinutes,
  cleanOptionalText,
  cleanSuccessCriteria,
} from "@/lib/input-validation";

/**
 * Mission lifecycle.
 *
 * Creating a mission is a plain insert; every *state* change goes through the
 * `set_mission_status` RPC so a mission can never be marked complete without the
 * matching XP event. See docs/ARCHITECTURE.md.
 */

export async function createMission(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const missionDate = cleanMissionDate(formData.get("missionDate"), "A mission date");
    const title = cleanMissionTitle(formData.get("title"));
    const priority = cleanMissionPriority(formData.get("priority"));
    const estimateMinutes = cleanOptionalMinutes(formData.get("estimateMinutes"));
    const successCriteria = cleanSuccessCriteria(formData.get("successCriteria"));
    const notes = cleanOptionalText(formData.get("notes"), "Notes", 4000);
    const questIdRaw = formData.get("questId");
    const questId =
      typeof questIdRaw === "string" && questIdRaw.trim().length > 0
        ? cleanId(questIdRaw, "A quest")
        : null;

    const { error } = await supabase.rpc("create_mission", {
      p_mission_date: missionDate,
      p_title: title,
      p_priority: priority,
      p_estimate_minutes: estimateMinutes,
      p_success_criteria: successCriteria,
      p_quest_id: questId,
      p_notes: notes,
    });
    if (error) throw new Error(error.message);

    revalidateStats();
    const unlocked = await runAchievementSweep(supabase);
    return success(`“${title}” added to ${missionDate}.`, unlocked);
  } catch (error) {
    return failure(error, "The mission could not be created.");
  }
}

export async function setMissionStatus(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const missionId = cleanId(formData.get("missionId"), "A mission");
    const status = cleanMissionStatus(formData.get("status"));
    const outcome = cleanOptionalText(formData.get("outcome"), "An outcome", 2000);

    if ((status === "skipped" || status === "blocked") && !outcome) {
      return { ok: false, error: `Record why this mission was ${status} — the reason is part of the record.` };
    }

    const { error } = await supabase.rpc("set_mission_status", {
      p_mission_id: missionId,
      p_status: status,
      p_outcome: outcome,
    });
    if (error) throw new Error(error.message);

    revalidateStats();
    const unlocked = await runAchievementSweep(supabase);
    const verbs: Record<string, string> = {
      planned: "returned to the plan",
      active: "moved to active",
      completed: "completed (+50 XP)",
      skipped: "marked skipped",
      blocked: "marked blocked",
    };
    return success(`Mission ${verbs[status] ?? "updated"}.`, unlocked);
  } catch (error) {
    return failure(error, "The mission status could not be changed.");
  }
}

export async function reopenMission(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const missionId = cleanId(formData.get("missionId"), "A mission");
    const { error } = await supabase.rpc("reopen_mission", { p_mission_id: missionId });
    if (error) throw new Error(error.message);
    revalidateStats();
    return success("Mission reopened — its XP was removed, not duplicated.");
  } catch (error) {
    return failure(error, "The mission could not be reopened.");
  }
}

export async function deleteMission(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const missionId = cleanId(formData.get("missionId"), "A mission");
    if (formData.get("confirm") !== "yes") {
      return { ok: false, error: "Deleting a mission needs confirmation." };
    }
    const { error } = await supabase.from("daily_missions").delete().eq("id", missionId);
    if (error) throw new Error(error.message);
    revalidateStats();
    return success("Mission deleted.");
  } catch (error) {
    return failure(error, "The mission could not be deleted.");
  }
}

export async function updateMissionPlan(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const missionId = cleanId(formData.get("missionId"), "A mission");
    const title = cleanMissionTitle(formData.get("title"));
    const priority = cleanMissionPriority(formData.get("priority"));
    const estimateMinutes = cleanOptionalMinutes(formData.get("estimateMinutes"));
    const successCriteria = cleanSuccessCriteria(formData.get("successCriteria"));
    const notes = cleanOptionalText(formData.get("notes"), "Notes", 4000);
    const missionDate = cleanMissionDate(formData.get("missionDate"), "A mission date");

    // Only planned fields are writable by a client; status is owned by the RPC.
    const { error } = await supabase
      .from("daily_missions")
      .update({ title, priority, estimate_minutes: estimateMinutes, success_criteria: successCriteria, notes, mission_date: missionDate })
      .eq("id", missionId);
    if (error) throw new Error(error.message);
    revalidateStats();
    return success("Mission plan updated.");
  } catch (error) {
    return failure(error, "The mission plan could not be updated.");
  }
}
