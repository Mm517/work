import "server-only";
import { createServerSupabase } from "@/lib/supabase-server";
import { createAdminSupabase } from "@/lib/supabase-admin";
import { decryptToken } from "@/lib/crypto";

export const SLUG_RE = /^[a-z0-9_-]{3,64}$/;

export type OwnerCtx = {
  userId: string;
  userName: string;
  room: { id: string; slug: string; name: string };
  supabase: Awaited<ReturnType<typeof createServerSupabase>>;
};

/** Verifies the session AND that the caller owns the room. Returns a Response on failure. */
export async function requireOwner(slug: string | null | undefined): Promise<OwnerCtx | Response> {
  if (!slug || !SLUG_RE.test(slug)) return Response.json({ error: "غرفة غير صالحة" }, { status: 400 });
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "لازم تسجّل دخول" }, { status: 401 });
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, name, owner_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!room) return Response.json({ error: "مش عضو في الغرفة دي" }, { status: 403 });
  if (room.owner_id !== user.id) return Response.json({ error: "ده متاح لصاحب الغرفة بس" }, { status: 403 });
  const { data: p } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  return {
    userId: user.id,
    userName: p?.display_name || user.email?.split("@")[0] || "owner",
    room: { id: room.id, slug: room.slug, name: room.name },
    supabase,
  };
}

export async function getRoomToken(roomId: string): Promise<string | null> {
  const { data } = await createAdminSupabase()
    .from("github_tokens")
    .select("token_enc")
    .eq("room_id", roomId)
    .maybeSingle();
  return data ? decryptToken(data.token_enc as string) : null;
}

export async function getLinkedRepo(roomId: string) {
  const { data } = await createAdminSupabase()
    .from("room_github")
    .select("repo_full_name, default_branch")
    .eq("room_id", roomId)
    .maybeSingle();
  return data ? { repo: data.repo_full_name as string, branch: data.default_branch as string } : null;
}

export function ghErrorResponse(e: unknown): Response {
  const status = typeof (e as { status?: number })?.status === "number" ? (e as { status: number }).status : 500;
  const message = e instanceof Error ? e.message : "خطأ غير متوقع";
  // a revoked/expired GitHub token surfaces as 401 from GitHub: tell the UI to reconnect
  return Response.json({ error: message, reconnect: status === 401 }, { status: status === 401 ? 401 : status >= 400 && status < 600 ? status : 500 });
}
