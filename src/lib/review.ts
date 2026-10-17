/**
 * Day-review rules.
 *
 * A review describes a *finished* day: today or any earlier calendar date. The date
 * arrives from the URL, so it is untrusted — this module is the single place that
 * decides which day a review may describe.
 */

import { daysBetween, isValidDateString } from "./dates";

/**
 * The date a review may show. A missing or malformed value falls back to `today`,
 * and a future date is clamped to `today`: a review can never look ahead.
 */
export function resolveReviewDate(requested: string | string[] | undefined, today: string): string {
  const value = Array.isArray(requested) ? requested[0] : requested;
  if (!value || !isValidDateString(value)) return today;
  return daysBetween(today, value) > 0 ? today : value;
}

/** "Today", "Yesterday", "Tomorrow", or the date itself. */
export function relativeDayLabel(date: string, today: string): string {
  const offset = daysBetween(today, date);
  if (offset === 0) return "Today";
  if (offset === -1) return "Yesterday";
  if (offset === 1) return "Tomorrow";
  return date;
}
