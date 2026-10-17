import { describe, expect, it } from "vitest";
import { formatDuration, isStaleSession } from "./focus";

describe("focus durations", () => {
  it("describes a recorded duration without rounding it up", () => {
    expect(formatDuration(1)).toBe("1 s");
    expect(formatDuration(59)).toBe("59 s");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(3599)).toBe("59 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3661)).toBe("1 h 1 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(86399)).toBe("23 h 59 min");
  });

  it("never invents time that was not measured", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(-30)).toBe("0 min");
    expect(formatDuration(null)).toBe("0 min");
    expect(formatDuration(undefined)).toBe("0 min");
    expect(formatDuration(Number.NaN)).toBe("0 min");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0 min");
  });
});

describe("abandoned sessions", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");

  it("flags a session that has been running far too long", () => {
    expect(isStaleSession("2026-10-18T11:59:00.000Z", now)).toBe(false);
    // Exactly at the threshold is not yet suspicious.
    expect(isStaleSession("2026-10-18T00:00:00.000Z", now)).toBe(false);
    expect(isStaleSession("2026-10-17T23:59:59.000Z", now)).toBe(true);
    expect(isStaleSession("2026-10-15T08:00:00.000Z", now)).toBe(true);
  });

  it("takes the threshold as a parameter instead of hiding it", () => {
    expect(isStaleSession("2026-10-18T10:30:00.000Z", now, 1)).toBe(true);
    expect(isStaleSession("2026-10-18T11:30:00.000Z", now, 1)).toBe(false);
  });

  it("stays quiet when the start time cannot be trusted", () => {
    expect(isStaleSession("not a date", now)).toBe(false);
    // A future start is a clock problem, not an abandoned session.
    expect(isStaleSession("2026-10-18T13:00:00.000Z", now)).toBe(false);
  });
});
