import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncAchievements } from "@/lib/queries";

/** Every write in LEVI OS is scoped to the signed-in user; RLS enforces it again. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Your session has expired. Sign in again to save changes.");
  return { supabase, userId: user.id };
}

/** Paths whose derived statistics change whenever XP, missions or habits change. */
export const STAT_PATHS = ["/dashboard", "/missions", "/habits", "/quests"] as const;

export function revalidateStats(): void {
  for (const path of STAT_PATHS) revalidatePath(path);
}

/**
 * Achievement sweep. Runs after a mutation as an idempotent, best-effort automation:
 * a failure here must never lose the user's actual work, so it is reported but not fatal.
 */
export async function runAchievementSweep(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string[]> {
  try {
    return await syncAchievements(supabase);
  } catch (error) {
    console.error("Achievement sweep failed:", error instanceof Error ? error.message : error);
    return [];
  }
}
