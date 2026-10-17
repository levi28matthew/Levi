import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  eachDate,
  isValidDateString,
  isoWeekday,
  startOfWeek,
  toCalendarDate,
  uniqueSortedDates,
} from "./dates";

describe("calendar dates", () => {
  it("validates real calendar dates, not just well-formed strings", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("26-01-01")).toBe(false);
    expect(isValidDateString(20260101)).toBe(false);
  });

  it("resolves the user's calendar date across the UTC boundary", () => {
    const instant = "2026-01-01T02:00:00.000Z";
    expect(toCalendarDate(instant, "America/Los_Angeles")).toBe("2025-12-31");
    expect(toCalendarDate(instant, "UTC")).toBe("2026-01-01");
    expect(toCalendarDate(instant, "Asia/Tokyo")).toBe("2026-01-01");
  });

  it("handles DST transitions in the user's zone", () => {
    // 2026-03-08 is the US spring-forward date; 09:30 UTC is 01:30 local (still the 8th).
    expect(toCalendarDate("2026-03-08T09:30:00.000Z", "America/New_York")).toBe("2026-03-08");
    expect(toCalendarDate("2026-03-08T07:30:00.000Z", "America/New_York")).toBe("2026-03-08");
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("measures whole days and ISO weekdays", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(daysBetween("2026-01-08", "2026-01-01")).toBe(-7);
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
  });

  it("enumerates and normalizes ranges", () => {
    expect(eachDate("2026-01-01", "2026-01-03")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(eachDate("2026-01-03", "2026-01-01")).toEqual([]);
    expect(uniqueSortedDates(["2026-01-02", "bad", "2026-01-01", "2026-01-02"])).toEqual([
      "2026-01-01",
      "2026-01-02",
    ]);
  });
});
