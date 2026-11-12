import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getLinkedRepo, getRoomToken, ghErrorResponse, requireOwner, type OwnerCtx } from "@/lib/github-auth";
import { diffAgainstTree, getTree, pushChanges } from "@/lib/github";

const MAX_FILES = 100;

async function loadFiles(ctx: OwnerCtx) {
  const { data } = await ctx.supabase.from("files").select("path, content").eq("room_id", ctx.room.id);
  return (data ?? []).map((r) => ({ path: r.path as string, content: (r.content as string) ?? "" }));
}

/** Preview: which workspace files differ from the linked repo. Writes nothing. */
export async function GET(req: NextRequest) {
  const ctx = await requireOwner(req.nextUrl.searchParams.get("room"));
  if (ctx instanceof Response) return ctx;
  try {
    const [token, linked] = await Promise.all([getRoomToken(ctx.room.id), getLinkedRepo(ctx.room.id)]);
    if (!token || !linked) return Response.json({ error: "GitHub أو المستودع مش مربوط" }, { status: 409 });
    const { entries } = await getTree(token, linked.repo, linked.branch);
    return Response.json({ ...linked, changes: diffAgainstTree(await loadFiles(ctx), entries) });
  } catch (e) {
    return ghErrorResponse(e);
  }
}

/** Push the owner-confirmed paths to a NEW branch (+ optional PR). Contents are re-read server-side. */
export async function POST(req: Request) {
  let body: { room?: string; paths?: string[]; message?: string; mode?: "pr" | "commit"; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  const ctx = await requireOwner(body.room);
  if (ctx instanceof Response) return ctx;
  if (body.confirm !== true) return Response.json({ error: "لازم تأكيد صريح من الـ owner" }, { status: 400 });
  const message = (body.message ?? "").trim();
  if (message.length < 3 || message.length > 200) return Response.json({ error: "رسالة الـ commit من 3 لـ 200 حرف" }, { status: 400 });
  if (!Array.isArray(body.paths) || body.paths.length === 0 || body.paths.length > MAX_FILES)
    return Response.json({ error: `اختار من 1 لـ ${MAX_FILES} ملف` }, { status: 400 });

  try {
    const [token, linked] = await Promise.all([getRoomToken(ctx.room.id), getLinkedRepo(ctx.room.id)]);
    if (!token || !linked) return Response.json({ error: "GitHub أو المستودع مش مربوط" }, { status: 409 });

    // only files that really differ AND were selected; traversal-looking paths are dropped
    const safe = new Set(body.paths.filter((p) => !p.startsWith("/") && !p.split("/").includes("..") && !p.includes("\\")));
    const { entries } = await getTree(token, linked.repo, linked.branch);
    const all = await loadFiles(ctx);
    const changed = new Set(diffAgainstTree(all, entries).map((c) => c.path));
    const files = all.filter((f) => safe.has(f.path) && changed.has(f.path));
    if (files.length === 0) return Response.json({ error: "مفيش تغييرات تتدفع" }, { status: 409 });

    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const newBranch = `kitchenly/${stamp}-${randomBytes(3).toString("hex")}`;
    const out = await pushChanges({
      token,
      repo: linked.repo,
      baseBranch: linked.branch,
      newBranch,
      message: `${message}\n\nPushed from Kitchenly Work by ${ctx.userName}`,
      files,
      openPr: body.mode !== "commit",
      prTitle: message,
      prBody: `Changes pushed from **Kitchenly Work** (${ctx.room.name}) by ${ctx.userName}.\n\n${files.map((f) => `- \`${f.path}\``).join("\n")}`,
    });
    return Response.json({ branch: newBranch, files: files.length, ...out });
  } catch (e) {
    return ghErrorResponse(e);
  }
}
