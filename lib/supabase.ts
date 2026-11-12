import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Browser client (session lives in cookies so server routes see it too). Call from effects/handlers only. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase غير مضبوط: ضيف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في .env.local"
    );
  }
  client = createBrowserClient(url, key, {
    realtime: { params: { eventsPerSecond: 30 } },
  });
  return client;
}

/** Private Realtime channels need the user's JWT on the socket before subscribing. */
export async function ensureRealtimeAuth(sb: SupabaseClient): Promise<void> {
  const { data } = await sb.auth.getSession();
  if (data.session?.access_token) await sb.realtime.setAuth(data.session.access_token);
}
