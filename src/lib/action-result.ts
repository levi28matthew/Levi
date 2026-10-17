/** Shape returned by every server action, so forms can render messages repeatably. */
export interface ActionResult {
  ok: boolean;
  /** Success text shown to the user. */
  message?: string;
  /** Validation or database message shown to the user. */
  error?: string;
  /** Achievements unlocked by this action, if any. */
  unlocked?: string[];
}

export const idleResult: ActionResult | null = null;

export function success(message: string, unlocked?: string[]): ActionResult {
  return unlocked && unlocked.length > 0 ? { ok: true, message, unlocked } : { ok: true, message };
}

export function failure(error: unknown, fallback = "Something went wrong. Nothing was saved."): ActionResult {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return { ok: false, error: message.trim() || fallback };
}
