import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client. Bypasses RLS: only use in route handlers AFTER verifying the caller yourself. */
export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
