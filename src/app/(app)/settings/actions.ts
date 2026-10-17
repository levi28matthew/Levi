"use server";

import { revalidatePath } from "next/cache";
import { failure, success, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { cleanOptionalText, cleanTimeZone } from "@/lib/input-validation";

/** Time zone is validated against the database's own tz database, server-side. */
export async function saveTimeZone(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const timeZone = cleanTimeZone(formData.get("timeZone"));
    const { error } = await supabase.rpc("set_time_zone", { p_time_zone: timeZone });
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/missions");
    revalidatePath("/habits");
    return success(`Time zone set to ${timeZone}. Today is now computed from it.`);
  } catch (error) {
    return failure(error, "The time zone could not be saved.");
  }
}

export async function saveDisplayName(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, userId } = await requireUser();
    const displayName = cleanOptionalText(formData.get("displayName"), "A display name", 80);
    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", userId);
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return success("Display name saved.");
  } catch (error) {
    return failure(error, "The display name could not be saved.");
  }
}
