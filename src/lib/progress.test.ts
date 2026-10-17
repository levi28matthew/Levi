import { describe, expect, it } from "vitest";
import { progressFromSteps, progressFromSubquests, statusForProgress } from "./progress";
import { levelForXp } from "./utils";

describe("progress engine", () => {
  it("derives canonical progress from completed steps", () => {
    expect(progressFromSteps([{ completedAt: null }, { completedAt: "2026-09-11" }])).toBe(50);
  });

  it("derives status from progress", () => {
    expect(statusForProgress(0)).toBe("not_started");
    expect(statusForProgress(1)).toBe("in_progress");
    expect(statusForProgress(100)).toBe("done");
  });

  it("derives main quest progress from direct subquests", () => {
    expect(progressFromSubquests([100, 50, 0])).toBe(50);
    expect(progressFromSubquests([])).toBe(0);
  });

  it("delegates levels to the canonical progression engine", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(250)).toBe(2);
    expect(levelForXp(1_000)).toBe(3);
  });
});
