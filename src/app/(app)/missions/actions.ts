"use server";

import { revalidateStats, requireUser, runAchievementSweep } from "@/lib/auth";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { getMissionsForDate } from "@/lib/queries";
import { moveInOrder, reorderTargets } from "@/lib/ordering";
import {
  cleanId,
  cleanMissionDate,
  cleanMissionPriority,
  cleanMissionStatus,
  cleanMissionTitle,
  cleanMoveDirection,
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

/**
 * Move an open mission one place earlier or later in its day.
 *
 * The browser only says *which way*; the order itself is read from the database and
 * the whole day's list is rebuilt here before `reorder_missions()` is called. A
 * client can therefore never invent an order, drop a mission from it, or renumber
 * anybody else's plan — and a stale form (the mission was resolved, or the page was
 * left open) does nothing instead of shuffling the list wrongly.
 */
export async function moveMission(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const missionId = cleanId(formData.get("missionId"), "A mission");
    const missionDate = cleanMissionDate(formData.get("missionDate"), "A mission date");
    const direction = cleanMoveDirection(formData.get("direction"));

    const missions = await getMissionsForDate(supabase, missionDate);
    const mission = missions.find((row) => row.id === missionId);
    if (!mission) {
      return { ok: false, error: "That mission is no longer planned for this day. Reload the page and try again." };
    }
    if (mission.status !== "planned" && mission.status !== "active") {
      return { ok: false, error: "Only open missions can be reordered — resolved work is a record, not a plan." };
    }

    const openIds = missions
      .filter((row) => row.status === "planned" || row.status === "active")
      .map((row) => row.id);
    const targets = reorderTargets(openIds, missionId, direction);
    if (!targets) {
      // Not an error: the mission is already where the user wants it.
      return success(
        direction === "up" ? `“${mission.title}” is already first in the day.` : `“${mission.title}” is already last in the day.`,
      );
    }

    const order = moveInOrder(
      missions.map((row) => row.id),
      openIds[targets.currentIndex],
      openIds[targets.targetIndex],
    );
    const { error } = await supabase.rpc("reorder_missions", { p_mission_date: missionDate, p_ids: order });
    if (error) throw new Error(error.message);

    revalidateStats();
    return success(`“${mission.title}” moved ${direction === "up" ? "earlier" : "later"}.`);
  } catch (error) {
    return failure(error, "The mission order could not be changed.");
  }
}
