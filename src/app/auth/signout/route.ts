import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-out is a POST route (never a GET) so a stray link or prefetch cannot end a
 * session. 303 sends the browser to the login page with a GET afterwards.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
