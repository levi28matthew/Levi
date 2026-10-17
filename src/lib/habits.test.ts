import { describe, expect, it } from "vitest";
import { consistency, currentStreak, longestStreak, scheduleFromWeekdays, summarizeHabit } from "./habits";

const daily = { frequency: "daily" as const };
const done = (...dates: string[]) => dates.map((date) => ({ date, completed: true }));

describe("habit streaks", () => {
  it("counts consecutive days ending today", () => {
    expect(currentStreak(done("2026-10-16", "2026-10-17", "2026-10-18"), "2026-10-18")).toBe(3);
  });

  it("keeps the streak alive while today is still open", () => {
    expect(currentStreak(done("2026-10-16", "2026-10-17"), "2026-10-18")).toBe(2);
  });

  it("breaks the streak when today is explicitly marked as not done", () => {
    const logs = [...done("2026-10-16", "2026-10-17"), { date: "2026-10-18", completed: false }];
    expect(currentStreak(logs, "2026-10-18")).toBe(0);
  });

  it("breaks the streak when the previous expected day was missed", () => {
    expect(currentStreak(done("2026-10-15", "2026-10-16"), "2026-10-18")).toBe(0);
  });

  it("ignores future-dated logs instead of inflating the streak", () => {
    expect(currentStreak(done("2026-10-19", "2026-10-18", "2026-10-17"), "2026-10-18")).toBe(2);
  });

  it("returns zero for a habit that has never been logged", () => {
    expect(currentStreak([], "2026-10-18")).toBe(0);
  });

  it("computes the longest historical streak", () => {
    expect(longestStreak(done("2026-01-01", "2026-01-02", "2026-01-03", "2026-01-10"))).toBe(3);
    expect(longestStreak([])).toBe(0);
  });

  it("handles a streak that crosses a month boundary", () => {
    expect(currentStreak(done("2026-01-30", "2026-01-31", "2026-02-01"), "2026-02-01")).toBe(3);
  });
});

const weekdaysOnly = scheduleFromWeekdays([1, 3, 5]); // Mon/Wed/Fri

describe("habit schedules", () => {
  it("falls back to daily when no weekdays are configured", () => {
    expect(scheduleFromWeekdays(null)).toEqual(daily);
    expect(scheduleFromWeekdays([1, 2, 3, 4, 5, 6, 7])).toEqual(daily);
  });

  it("counts streaks over scheduled occurrences, not calendar days", () => {
    // Mon 2026-01-05, Wed 2026-01-07, Fri 2026-01-09 — unscheduled days must not break it.
    expect(currentStreak(done("2026-01-05", "2026-01-07", "2026-01-09"), "2026-01-09", weekdaysOnly)).toBe(3);
  });

  it("keeps a Mon/Wed/Fri streak alive on an unscheduled today", () => {
    // Friday 2026-01-09 was the last scheduled day; today is Saturday.
    expect(currentStreak(done("2026-01-05", "2026-01-07", "2026-01-09"), "2026-01-10", weekdaysOnly)).toBe(3);
  });

  it("breaks when a scheduled occurrence is missed", () => {
    expect(currentStreak(done("2026-01-05", "2026-01-09"), "2026-01-09", weekdaysOnly)).toBe(1);
  });

  it("measures longest streak per scheduled occurrence", () => {
    expect(longestStreak(done("2026-01-05", "2026-01-07", "2026-01-12", "2026-01-14"), weekdaysOnly)).toBe(2);
  });
});

describe("consistency reporting", () => {
  it("measures completion against expected days only", () => {
    const report = consistency(
      [
        { date: "2026-01-05", completed: true },
        { date: "2026-01-07", completed: true },
        { date: "2026-01-06", completed: true }, // Tuesday: not scheduled
      ],
      weekdaysOnly,
      "2026-01-05",
      "2026-01-11",
    );
    expect(report.expected).toBe(3); // Mon, Wed, Fri
    expect(report.completed).toBe(2);
    expect(report.missedDates).toEqual(["2026-01-09"]);
    expect(report.consistencyPercent).toBe(67);
    expect(report.offScheduleCount).toBe(1);
  });

  it("does not treat an unlogged day as a completion", () => {
    const report = consistency([], daily, "2026-01-01", "2026-01-03");
    expect(report.completed).toBe(0);
    expect(report.consistencyPercent).toBe(0);
    expect(report.missedDates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("summarizes a habit in one call", () => {
    const summary = summarizeHabit(
      done("2026-10-16", "2026-10-17"),
      daily,
      "2026-10-12",
      "2026-10-18",
      "2026-10-18",
    );
    expect(summary.currentStreak).toBe(2);
    expect(summary.longestStreak).toBe(2);
    expect(summary.completed).toBe(2);
    expect(summary.missedDates).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-18"]);
  });
});
