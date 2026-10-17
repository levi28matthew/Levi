/**
 * Canonical progression engine.
 *
 * This is the single authoritative definition of how lifetime XP maps to levels.
 * The identical formula is implemented in SQL (`public.xp_for_level` / `public.level_for_xp`)
 * and the two are covered by tests, so a dashboard number and a database number agree.
 *
 * Formula
 * -------
 * Total XP required to *reach* level L is a triangular number:
 *
 *     xpForLevel(L) = XP_LEVEL_STEP * (L - 1) * L / 2
 *
 * With `XP_LEVEL_STEP = 250`:
 *   L1 = 0      L2 = 250     L3 = 750     L4 = 1500    L5 = 2500    L6 = 3750
 *
 * The XP needed to *complete* a level therefore grows linearly by 250 each time
 * (level 2 costs 250, level 3 costs 500 more, level 4 costs 750 more …), which keeps
 * early progress rewarding without letting late levels trivialise.
 *
 * Progress within the current level is always derived from the ledger total — it is
 * never stored, so it cannot drift from the XP events that produced it.
 */

export const XP_LEVEL_STEP = 250;

/** Levels are 1-based; guard against runaway loops for corrupt input. */
const MAX_LEVEL = 10_000;

function normalizeTotalXp(totalXp: number): number {
  if (!Number.isFinite(totalXp)) throw new Error("XP totals must be finite numbers.");
  return Math.max(0, Math.floor(totalXp));
}

/** Cumulative lifetime XP required to reach `level` (level 1 requires 0 XP). */
export function xpForLevel(level: number): number {
  const target = Math.max(1, Math.floor(level));
  return (XP_LEVEL_STEP * (target - 1) * target) / 2;
}

/** The level a lifetime XP total corresponds to. Exact — no floating-point approximation. */
export function levelForXp(totalXp: number): number {
  const xp = normalizeTotalXp(totalXp);
  let level = 1;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) level += 1;
  return level;
}

export interface LevelProgress {
  /** Total lifetime XP (never resets between levels). */
  totalXp: number;
  /** Current level, 1-based. */
  level: number;
  /** XP earned since reaching the current level. */
  xpIntoLevel: number;
  /** XP required to go from the current level to the next one. */
  xpForNextLevel: number;
  /** XP still needed to reach the next level (0 when exactly at the threshold). */
  xpToNextLevel: number;
  /** 0–100 completion of the current level, rounded. */
  progressPercent: number;
}

/** Full, display-ready breakdown of a lifetime XP total. */
export function levelProgress(totalXp: number): LevelProgress {
  const xp = normalizeTotalXp(totalXp);
  const level = levelForXp(xp);
  const floorXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  const xpIntoLevel = xp - floorXp;
  const xpForNextLevel = nextXp - floorXp;
  const progressPercent = xpForNextLevel === 0 ? 100 : Math.round((xpIntoLevel / xpForNextLevel) * 100);
  return {
    totalXp: xp,
    level,
    xpIntoLevel,
    xpForNextLevel,
    xpToNextLevel: Math.max(0, nextXp - xp),
    progressPercent,
  };
}

// ---------------------------------------------------------------------------
// XP award amounts — one place, so the client and the database cannot disagree.
// ---------------------------------------------------------------------------

export type XpSource =
  | "quest_completion"
  | "daily_mission"
  | "habit"
  | "milestone"
  | "bonus"
  | "achievement";

export const XP_AWARDS = {
  /** A subquest whose every step is complete. */
  subquestCompleted: 250,
  /** A main quest whose every direct subquest is complete. */
  mainQuestCompleted: 1_000,
  /** A daily mission marked done. */
  dailyMissionCompleted: 50,
  /** A mission that was planned but explicitly skipped — partial credit, recorded honestly. */
  dailyMissionSkipped: 0,
  /** A habit logged for a calendar day. */
  habitLogged: 20,
} as const;

/** XP awarded for one completion event. Pure — callers persist the result in the ledger. */
export function xpForMission(status: MissionOutcome): number {
  if (status === "completed") return XP_AWARDS.dailyMissionCompleted;
  return 0;
}

export type MissionOutcome = "completed" | "skipped" | "blocked";

// ---------------------------------------------------------------------------
// Achievements: explicit, testable rules over a real statistics snapshot.
// ---------------------------------------------------------------------------

export interface PlayerSnapshot {
  totalXp: number;
  level: number;
  questsCompleted: number;
  subquestsCompleted: number;
  missionsCompleted: number;
  habitsLogged: number;
  longestHabitStreak: number;
}

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  /** XP granted once, the first time the rule becomes true. */
  xp: number;
  unlocks: (snapshot: PlayerSnapshot) => boolean;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    id: "first_blood",
    title: "First Blood",
    description: "Complete your first daily mission.",
    xp: 25,
    unlocks: (s) => s.missionsCompleted >= 1,
  },
  {
    id: "provable_progress",
    title: "Provable Progress",
    description: "Complete a subquest where every step is backed by evidence.",
    xp: 50,
    unlocks: (s) => s.subquestsCompleted >= 1,
  },
  {
    id: "quest_closer",
    title: "Quest Closer",
    description: "Finish a main quest end to end.",
    xp: 150,
    unlocks: (s) => s.questsCompleted >= 1,
  },
  {
    id: "streak_7",
    title: "Seven Day Streak",
    description: "Keep a habit alive for seven consecutive days.",
    xp: 100,
    unlocks: (s) => s.longestHabitStreak >= 7,
  },
  {
    id: "streak_30",
    title: "Thirty Day Streak",
    description: "Keep a habit alive for thirty consecutive days.",
    xp: 500,
    unlocks: (s) => s.longestHabitStreak >= 30,
  },
  {
    id: "habitual",
    title: "Habitual",
    description: "Log 100 habit completions.",
    xp: 200,
    unlocks: (s) => s.habitsLogged >= 100,
  },
  {
    id: "level_5",
    title: "Ascendant",
    description: "Reach level 5.",
    xp: 100,
    unlocks: (s) => s.level >= 5,
  },
  {
    id: "level_10",
    title: "Unstoppable",
    description: "Reach level 10.",
    xp: 250,
    unlocks: (s) => s.level >= 10,
  },
];

/**
 * Achievements that are earned but not yet recorded.
 * `alreadyUnlocked` must come from persisted records, so XP is never awarded twice.
 */
export function newlyUnlockedAchievements(
  snapshot: PlayerSnapshot,
  alreadyUnlocked: Iterable<string>,
): AchievementDefinition[] {
  const owned = new Set(alreadyUnlocked);
  return ACHIEVEMENTS.filter((achievement) => !owned.has(achievement.id) && achievement.unlocks(snapshot));
}
