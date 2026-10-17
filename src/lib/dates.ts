/**
 * Calendar-date utilities.
 *
 * LEVI OS stores habit logs, missions and journals against a *local calendar date*
 * (`YYYY-MM-DD`), never against a UTC instant. This module is the single place that
 * converts an instant to a calendar date for a given IANA time zone, so streaks and
 * "today" never drift because of a UTC/local mismatch.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a valid `YYYY-MM-DD` calendar date (not just a well-formed string). */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Reject impossible dates such as 2026-02-30 by round-tripping through UTC noon.
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Parse `YYYY-MM-DD` into a UTC-noon Date. Throws on invalid input. */
export function parseDateString(value: string): Date {
  if (!isValidDateString(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function dateStringFromUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Convert an instant to the calendar date the user is experiencing in `timeZone`.
 * Uses `Intl` so the platform's tz database decides offsets (including DST).
 */
export function toCalendarDate(instant: Date | string | number, timeZone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error("Cannot derive a date from an invalid instant.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = lookup("year");
  const month = lookup("month");
  const day = lookup("day");
  if (!year || !month || !day) throw new Error(`Unable to resolve a calendar date for time zone ${timeZone}.`);
  return `${year}-${month}-${day}`;
}

/** Add `days` to a `YYYY-MM-DD` string, returning a `YYYY-MM-DD` string. */
export function addDays(value: string, days: number): string {
  const date = parseDateString(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateStringFromUtcDate(date);
}

/** Whole days between two calendar dates (`to - from`). Negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const start = parseDateString(from).getTime();
  const end = parseDateString(to).getTime();
  return Math.round((end - start) / 86_400_000);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(value: string): number {
  const day = parseDateString(value).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week containing `value`. */
export function startOfWeek(value: string): string {
  return addDays(value, -(isoWeekday(value) - 1));
}

/** All dates from `from` to `to` inclusive, ascending. Returns `[]` when `to` precedes `from`. */
export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  let guard = 0;
  while (daysBetween(cursor, to) >= 0 && guard < 3660) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return dates;
}

/** Sort and de-duplicate calendar-date strings. */
export function uniqueSortedDates(values: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const value of values) if (isValidDateString(value)) set.add(value);
  return [...set].sort();
}
