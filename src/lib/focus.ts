/**
 * Focus-session rules.
 *
 * A session is measured, never guessed: the database timestamps the start and the
 * end, and the database computes the duration. This module only *describes* that
 * number (and decides when a running session looks abandoned) so every screen and
 * every server action tells the same story.
 */

/** The running-session warning threshold. Long enough for a real deep-work block. */
export const STALE_SESSION_HOURS = 12;

/**
 * A duration in words, rounded down to the unit that matters.
 *
 * Deliberately never rounds *up*: a session that lasted 59 minutes is "59 min",
 * not "1 h". Zero, negative and unusable values report "0 min" rather than
 * inventing time that was not recorded.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0 min";
  }
  const seconds = Math.floor(totalSeconds);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * True when a session has been running so long that it was almost certainly left
 * open (a closed tab, a dead battery, a forgotten timer).
 *
 * The caller uses this to *suggest* discarding it — never to end it silently: the
 * decision, and the record it leaves behind, stay with the user.
 */
export function isStaleSession(startedAt: string, now: Date, maxHours: number = STALE_SESSION_HOURS): boolean {
  const started = new Date(startedAt);
  const startedMs = started.getTime();
  if (Number.isNaN(startedMs)) return false;
  const elapsedMs = now.getTime() - startedMs;
  // A start time in the future is a clock problem, not an abandoned session.
  if (elapsedMs < 0) return false;
  return elapsedMs > maxHours * 3_600_000;
}
