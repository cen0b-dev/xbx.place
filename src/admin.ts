import type { User } from "@supabase/supabase-js";

/** Site moderator — set via Supabase Auth app_metadata: { "role": "admin" }. */
export function isSiteAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.app_metadata?.role === "admin";
}
