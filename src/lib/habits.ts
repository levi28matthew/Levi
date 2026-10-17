/**
 * Habit streak & consistency engine.
 *
 * Every function here works on `YYYY-MM-DD` calendar-date strings and a caller-supplied
 * set of completed dates. Nothing looks at "now" and nothing re-derives dates from a
 * UTC timestamp, which is exactly why streaks cannot reset because of a timezone
 * mismatch. The caller converts instants with `toCalendarDate(…, userTimeZone)`.
 */

import { addDays, daysBetween, eachDate, isoWeekday, uniqueSortedDates } from "./dates";

export interface DailySchedule {
  frequency: "daily";
}

export interface WeeklySchedule {
  frequency: "weekly";
  /** ISO weekdays the habit is expected: 1 = Monday … 7 = Sunday. */
  weekdays: readonly number[];
}

export type HabitSchedule = DailySchedule | WeeklySchedule;

export interface HabitLogRecord {
  /** `YYYY-MM-DD` */
  date: string;
  completed: boolean;
}

export function isScheduledOn(schedule: HabitSchedule, date: string): boolean {
  if (schedule.frequency === "daily") return true;
  return schedule.weekdays.includes(isoWeekday(date));
}

/** Calendar dates in `[from, to]` on which the habit was expected. */
export function scheduledDates(schedule: HabitSchedule, from: string, to: string): string[] {
  return eachDate(from, to).filter((date) => isScheduledOn(schedule, date));
}

export function completedDates(logs: readonly HabitLogRecord[]): string[] {
  return uniqueSortedDates(logs.filter((log) => log.completed).map((log) => log.date));
}

/**
 * Consecutive scheduled occurrences ending at `today`.
 *
 * One documented rule, shared with the SQL implementation in
 * `supabase/migrations/20260918100000_core_loop_engine.sql` (`habit_summary`):
 *
 *   1. If today was explicitly logged as *not* completed, the streak is 0 — the
 *      scheduled day was failed, not merely pending.
 *   2. If today is completed, the streak ends today.
 *   3. Otherwise today is still open, so the streak is measured up to the most
 *      recent *scheduled* occurrence before today.
 *
 * A day the habit was not scheduled for never breaks a streak.
 */
export function currentStreak(
  logs: readonly HabitLogRecord[],
  today: string,
  schedule: HabitSchedule = { frequency: "daily" },
): number {
  const done = new Set(completedDates(logs));
  if (logs.some((log) => log.date === today && !log.completed)) return 0;

  let cursor = today;
  if (!done.has(today)) {
    let guard = 0;
    do {
      cursor = addDays(cursor, -1);
      guard += 1;
    } while (!isScheduledOn(schedule, cursor) && guard < 3660);
  }

  let streak = 0;
  let guard = 0;
  while (guard < 3660) {
    if (isScheduledOn(schedule, cursor)) {
      if (!done.has(cursor)) break;
      streak += 1;
    }
    cursor = addDays(cursor, -1);
    guard += 1;
  }
  return streak;
}

export function longestStreak(
  logs: readonly HabitLogRecord[],
  schedule: HabitSchedule = { frequency: "daily" },
): number {
  const completed = completedDates(logs);
  if (schedule.frequency === "daily") {
    let best = 0;
    let run = 0;
    let previous: string | null = null;
    for (const date of completed) {
      run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
      previous = date;
      if (run > best) best = run;
    }
    return best;
  }

  // Weekly schedule: count consecutive *scheduled* occurrences, not consecutive days.
  if (completed.length === 0) return 0;
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of completed) {
    if (!isScheduledOn(schedule, date)) continue;
    if (previous !== null) {
      const between = eachDate(addDays(previous, 1), addDays(date, -1)).filter((day) =>
        isScheduledOn(schedule, day),
      );
      run = between.length === 0 ? run + 1 : 1;
    } else {
      run = 1;
    }
    previous = date;
    if (run > best) best = run;
  }
  return best;
}

export interface ConsistencyReport {
  from: string;
  to: string;
  /** Days the habit was expected in the window. */
  expected: number;
  /** Expected days that were completed. */
  completed: number;
  /** Expected days with no completion record. */
  missedDates: string[];
  /** 0–100, rounded. 100 when nothing was expected. */
  consistencyPercent: number;
  /** Completions that landed on days the habit was not scheduled (kept, counted separately). */
  offScheduleCount: number;
}

/** Consistency over a window, measured only against scheduled days. */
export function consistency(
  logs: readonly HabitLogRecord[],
  schedule: HabitSchedule,
  from: string,
  to: string,
): ConsistencyReport {
  const done = new Set(completedDates(logs));
  const expectedDates = scheduledDates(schedule, from, to);
  const allDates = eachDate(from, to);
  const missedDates = expectedDates.filter((date) => !done.has(date));
  const completed = expectedDates.length - missedDates.length;
  const offScheduleCount = allDates.filter((date) => done.has(date) && !isScheduledOn(schedule, date)).length;
  return {
    from,
    to,
    expected: expectedDates.length,
    completed,
    missedDates,
    consistencyPercent: expectedDates.length === 0 ? 100 : Math.round((completed / expectedDates.length) * 100),
    offScheduleCount,
  };
}

export interface HabitSummary extends ConsistencyReport {
  currentStreak: number;
  longestStreak: number;
}

/** Everything a habit card needs, computed from the log and one local "today". */
export function summarizeHabit(
  logs: readonly HabitLogRecord[],
  schedule: HabitSchedule,
  from: string,
  to: string,
  today: string,
): HabitSummary {
  return {
    ...consistency(logs, schedule, from, to),
    currentStreak: currentStreak(logs, today, schedule),
    longestStreak: longestStreak(logs, schedule),
  };
}

/** `weekly` schedule from a value stored in the database (ISO weekday numbers). */
export function scheduleFromWeekdays(weekdays: readonly number[] | null | undefined): HabitSchedule {
  if (!weekdays || weekdays.length === 0 || weekdays.length === 7) return { frequency: "daily" };
  return { frequency: "weekly", weekdays: weekdays.filter((day) => day >= 1 && day <= 7) };
}
