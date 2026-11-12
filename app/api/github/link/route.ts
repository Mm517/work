import { getRoomToken, ghErrorResponse, requireOwner } from "@/lib/github-auth";
import { REPO_RE, getRepo } from "@/lib/github";
import { createAdminSupabase } from "@/lib/supabase-admin";

export async function POST(req: Request) {
  let body: { room?: string; repo?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  const ctx = await requireOwner(body.room);
  if (ctx instanceof Response) return ctx;
  if (!body.repo || !REPO_RE.test(body.repo)) return Response.json({ error: "اسم مستودع غير صالح" }, { status: 400 });
  try {
    const token = await getRoomToken(ctx.room.id);
    if (!token) return Response.json({ error: "GitHub مش مربوط", reconnect: true }, { status: 409 });
    const repo = await getRepo(token, body.repo); // proves the token can actually see it
    const { error } = await createAdminSupabase().from("room_github").upsert({
      room_id: ctx.room.id,
      repo_full_name: repo.full_name,
      default_branch: repo.default_branch,
      connected_by: ctx.userId,
      connected_at: new Date().toISOString(),
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ repo: repo.full_name, branch: repo.default_branch });
  } catch (e) {
    return ghErrorResponse(e);
  }
}
