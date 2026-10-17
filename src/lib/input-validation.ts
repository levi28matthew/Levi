import { isValidDateString } from "./dates";
import type { MissionPriority, MissionStatus } from "@/types/database";

/**
 * Form-boundary validation for the daily loop. Everything the user can type is cleaned
 * here, on the server, before it reaches the database — which then validates it again
 * with real constraints. Never trust the browser.
 */

const MISSION_TITLE_MAX = 200;
const HABIT_NAME_MAX = 120;
const REASON_MAX = 2_000;
const CATEGORY_MAX = 60;
const SUCCESS_CRITERIA_MAX = 500;

const PRIORITIES: readonly MissionPriority[] = ["urgent", "high", "normal", "low"];
const STATUSES: readonly MissionStatus[] = ["planned", "active", "completed", "skipped", "blocked"];

function raw(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function cleanRequiredText(
  value: FormDataEntryValue | null | undefined,
  label: string,
  max: number,
): string {
  const text = raw(value);
  if (text.length < 1) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

/** Optional free text: empty becomes `null` rather than an empty string in the database. */
export function cleanOptionalText(
  value: FormDataEntryValue | null | undefined,
  label: string,
  max: number,
): string | null {
  const text = raw(value);
  if (text.length === 0) return null;
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function cleanMissionTitle(value: FormDataEntryValue | null | undefined): string {
  return cleanRequiredText(value, "A mission title", MISSION_TITLE_MAX);
}

export function cleanMissionPriority(value: FormDataEntryValue | null | undefined): MissionPriority {
  const priority = raw(value) || "normal";
  if (!PRIORITIES.includes(priority as MissionPriority)) throw new Error("Choose a valid priority.");
  return priority as MissionPriority;
}

export function cleanMissionStatus(value: FormDataEntryValue | null | undefined): MissionStatus {
  const status = raw(value);
  if (!STATUSES.includes(status as MissionStatus)) throw new Error("Choose a valid mission status.");
  return status as MissionStatus;
}

export function cleanMissionDate(value: FormDataEntryValue | null | undefined, label = "A mission date"): string {
  const date = raw(value);
  if (!isValidDateString(date)) throw new Error(`${label} must be a real calendar date (YYYY-MM-DD).`);
  return date;
}

/** `null` when unset, otherwise a whole number of minutes in 1…1440. */
export function cleanOptionalMinutes(value: FormDataEntryValue | null | undefined): number | null {
  const text = raw(value);
  if (text.length === 0) return null;
  if (!/^\d{1,4}$/.test(text)) throw new Error("An estimate must be a whole number of minutes.");
  const minutes = Number(text);
  if (minutes < 1 || minutes > 1440) throw new Error("An estimate must be between 1 and 1440 minutes.");
  return minutes;
}

export function cleanMissionReason(value: FormDataEntryValue | null | undefined): string | null {
  return cleanOptionalText(value, "A reason", REASON_MAX);
}

export function cleanHabitName(value: FormDataEntryValue | null | undefined): string {
  return cleanRequiredText(value, "A habit name", HABIT_NAME_MAX);
}

export function cleanHabitCategory(value: FormDataEntryValue | null | undefined): string | null {
  return cleanOptionalText(value, "A category", CATEGORY_MAX);
}

export function cleanSuccessCriteria(value: FormDataEntryValue | null | undefined): string | null {
  return cleanOptionalText(value, "Success criteria", SUCCESS_CRITERIA_MAX);
}

/**
 * ISO weekdays from checkbox values. `null` means "every day", which is how the
 * database stores an unset schedule.
 */
export function cleanWeekdays(values: readonly FormDataEntryValue[]): number[] | null {
  const chosen = new Set<number>();
  for (const value of values) {
    const text = raw(value);
    if (text.length === 0) continue;
    if (!/^[1-7]$/.test(text)) throw new Error("Habit weekdays must be between 1 (Mon) and 7 (Sun).");
    chosen.add(Number(text));
  }
  if (chosen.size === 0 || chosen.size === 7) return null;
  return [...chosen].sort((a, b) => a - b);
}

export function cleanTimeZone(value: FormDataEntryValue | null | undefined): string {
  const zone = raw(value);
  if (zone.length < 1 || zone.length > 64) throw new Error("Choose a time zone.");
  return zone;
}

export function cleanBoolean(value: FormDataEntryValue | null | undefined): boolean {
  const text = raw(value).toLowerCase();
  return text === "true" || text === "on" || text === "1" || text === "completed";
}

/** A uuid-shaped id, rejected early so a bad form cannot reach the database. */
export function cleanId(value: FormDataEntryValue | null | undefined, label = "An id"): string {
  const id = raw(value);
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    throw new Error(`${label} is not valid.`);
  }
  return id.toLowerCase();
}
