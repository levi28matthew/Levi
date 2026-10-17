import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  XP_AWARDS,
  XP_LEVEL_STEP,
  levelForXp,
  levelProgress,
  newlyUnlockedAchievements,
  xpForLevel,
  type PlayerSnapshot,
} from "./progression";

describe("level progression", () => {
  it("uses the documented triangular formula", () => {
    expect(XP_LEVEL_STEP).toBe(250);
    expect([
      xpForLevel(1),
      xpForLevel(2),
      xpForLevel(3),
      xpForLevel(4),
      xpForLevel(5),
    ]).toEqual([0, 250, 750, 1500, 2500]);
  });

  it("maps XP to levels exactly at every threshold boundary", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(249)).toBe(1);
    expect(levelForXp(250)).toBe(2);
    expect(levelForXp(749)).toBe(2);
    expect(levelForXp(750)).toBe(3);
    expect(levelForXp(1499)).toBe(3);
    expect(levelForXp(1500)).toBe(4);
  });

  it("round-trips levelForXp and xpForLevel over a wide range", () => {
    for (let level = 1; level <= 200; level += 1) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
      if (level > 1) expect(levelForXp(xpForLevel(level) - 1)).toBe(level - 1);
    }
  });

  it("reports progress inside the current level without losing lifetime XP", () => {
    const progress = levelProgress(1000); // level 3 spans 750 → 1500
    expect(progress).toEqual({
      totalXp: 1000,
      level: 3,
      xpIntoLevel: 250,
      xpForNextLevel: 750,
      xpToNextLevel: 500,
      progressPercent: 33,
    });
  });

  it("treats corrupt totals safely instead of producing NaN", () => {
    expect(levelForXp(-500)).toBe(1);
    expect(levelForXp(0.9)).toBe(1);
    expect(levelProgress(-10).totalXp).toBe(0);
    expect(() => levelForXp(Number.NaN)).toThrow("finite");
  });
});

const baseSnapshot: PlayerSnapshot = {
  totalXp: 0,
  level: 1,
  questsCompleted: 0,
  subquestsCompleted: 0,
  missionsCompleted: 0,
  habitsLogged: 0,
  longestHabitStreak: 0,
};

describe("achievements", () => {
  it("has uniquely identified, XP-positive rules", () => {
    const ids = ACHIEVEMENTS.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ACHIEVEMENTS.every((achievement) => achievement.xp > 0)).toBe(true);
  });

  it("unlocks nothing for a fresh player", () => {
    expect(newlyUnlockedAchievements(baseSnapshot, [])).toEqual([]);
  });

  it("unlocks rules whose thresholds are met", () => {
    const unlocked = newlyUnlockedAchievements({ ...baseSnapshot, missionsCompleted: 1, level: 5 }, []);
    expect(unlocked.map((achievement) => achievement.id)).toEqual(["first_blood", "level_5"]);
  });

  it("never re-awards an achievement that is already persisted", () => {
    const snapshot = { ...baseSnapshot, missionsCompleted: 1, subquestsCompleted: 3, questsCompleted: 1 };
    const unlocked = newlyUnlockedAchievements(snapshot, ["first_blood", "provable_progress"]);
    expect(unlocked.map((achievement) => achievement.id)).toEqual(["quest_closer"]);
  });

  it("keeps award amounts discoverable for the SQL layer", () => {
    expect(XP_AWARDS.subquestCompleted).toBe(250);
    expect(XP_AWARDS.mainQuestCompleted).toBe(1_000);
    expect(XP_AWARDS.dailyMissionCompleted).toBe(50);
  });
});
