import { describe, expect, it } from "vitest";
import { relativeDayLabel, resolveReviewDate } from "./review";

describe("day review dates", () => {
  const today = "2026-10-18";

  it("keeps a past date exactly as requested", () => {
    expect(resolveReviewDate("2026-10-11", today)).toBe("2026-10-11");
    expect(resolveReviewDate("2020-01-01", today)).toBe("2020-01-01");
  });

  it("never reviews the future", () => {
    expect(resolveReviewDate("2026-10-19", today)).toBe(today);
    expect(resolveReviewDate("2030-01-01", today)).toBe(today);
  });

  it("falls back to today for missing or malformed input", () => {
    expect(resolveReviewDate(undefined, today)).toBe(today);
    expect(resolveReviewDate("", today)).toBe(today);
    expect(resolveReviewDate("yesterday", today)).toBe(today);
    expect(resolveReviewDate("2026-02-30", today)).toBe(today);
    expect(resolveReviewDate(["2026-10-17", "2026-01-01"], today)).toBe("2026-10-17");
  });

  it("labels the days around today", () => {
    expect(relativeDayLabel(today, today)).toBe("Today");
    expect(relativeDayLabel("2026-10-17", today)).toBe("Yesterday");
    expect(relativeDayLabel("2026-10-01", today)).toBe("2026-10-01");
  });
});
