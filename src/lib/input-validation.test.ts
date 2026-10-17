import { describe, expect, it } from "vitest";
import {
  cleanBoolean,
  cleanHabitName,
  cleanId,
  cleanMissionDate,
  cleanMissionPriority,
  cleanMissionStatus,
  cleanOptionalMinutes,
  cleanOptionalText,
  cleanSuccessCriteria,
  cleanTimeZone,
  cleanWeekdays,
} from "./input-validation";

describe("mission and habit validation", () => {
  it("accepts well-formed input and trims it", () => {
    expect(cleanHabitName("  Train  ")).toBe("Train");
    expect(cleanMissionDate("2026-10-18")).toBe("2026-10-18");
    expect(cleanSuccessCriteria("  CV rewritten  ")).toBe("CV rewritten");
    expect(cleanOptionalMinutes("45")).toBe(45);
  });

  it("turns empty optional fields into null instead of empty strings", () => {
    expect(cleanOptionalText("   ", "A note", 10)).toBeNull();
    expect(cleanSuccessCriteria(null)).toBeNull();
    expect(cleanOptionalMinutes("")).toBeNull();
  });

  it("rejects impossible dates and bad numbers", () => {
    expect(() => cleanMissionDate("2026-02-30")).toThrow("calendar date");
    expect(() => cleanMissionDate("18/10/2026")).toThrow("calendar date");
    expect(() => cleanOptionalMinutes("0")).toThrow("between 1 and 1440");
    expect(() => cleanOptionalMinutes("99999")).toThrow("whole number");
  });

  it("rejects unknown enum values rather than defaulting silently", () => {
    expect(() => cleanMissionPriority("whenever")).toThrow("valid priority");
    expect(() => cleanMissionStatus("done")).toThrow("valid mission status");
    expect(cleanMissionPriority("")).toBe("normal");
  });

  it("enforces length limits", () => {
    expect(() => cleanHabitName("x".repeat(121))).toThrow("120 characters or fewer");
    expect(() => cleanHabitName("")).toThrow("required");
    expect(() => cleanSuccessCriteria("x".repeat(501))).toThrow("500 characters or fewer");
  });

  it("parses weekday checkboxes, treating none or all as daily", () => {
    expect(cleanWeekdays(["1", "3", "5"])).toEqual([1, 3, 5]);
    expect(cleanWeekdays([])).toBeNull();
    expect(cleanWeekdays(["1", "2", "3", "4", "5", "6", "7"])).toBeNull();
    expect(() => cleanWeekdays(["9"])).toThrow("between 1 (Mon) and 7 (Sun)");
  });

  it("validates ids and booleans", () => {
    expect(cleanId("11111111-1111-1111-1111-111111111111")).toBe("11111111-1111-1111-1111-111111111111");
    expect(() => cleanId("not-an-id")).toThrow("not valid");
    expect(cleanBoolean("true")).toBe(true);
    expect(cleanBoolean("off")).toBe(false);
  });

  it("passes a time zone through for server-side validation", () => {
    expect(cleanTimeZone("Europe/London")).toBe("Europe/London");
    expect(() => cleanTimeZone("")).toThrow("Choose a time zone");
  });
});
