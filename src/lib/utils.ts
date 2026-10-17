export function formatXp(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.floor(Number.isFinite(value) ? value : 0));
}

/**
 * Re-exported from the canonical progression engine so existing callers keep working.
 * Do not re-implement the formula here.
 */
export { levelForXp, levelProgress, xpForLevel } from "./progression";
export type { LevelProgress } from "./progression";

/** `true` when a string is a usable http(s) URL (used to validate evidence links). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
