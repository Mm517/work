import type { NextRequest } from "next/server";
import { getLinkedRepo, getRoomToken, ghErrorResponse, requireOwner } from "@/lib/github-auth";
import { getTree, lastCommit } from "@/lib/github";
import { largest } from "@/lib/structure";

export async function GET(req: NextRequest) {
  const ctx = await requireOwner(req.nextUrl.searchParams.get("room"));
  if (ctx instanceof Response) return ctx;

  // workspace side: who touched each file last (RLS-scoped read as the owner)
  const { data: rows } = await ctx.supabase
    .from("files")
    .select("path, content, updated_at, updated_by")
    .eq("room_id", ctx.room.id);
  const ids = [...new Set((rows ?? []).map((r) => r.updated_by as string | null).filter(Boolean))] as string[];
  const { data: ps } = ids.length
    ? await ctx.supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string }[] };
  const names = new Map((ps ?? []).map((p) => [p.id as string, p.display_name as string]));
  const workspace = (rows ?? []).map((r) => ({
    path: r.path as string,
    size: Buffer.byteLength((r.content as string) ?? "", "utf8"),
    updatedAt: r.updated_at as string,
    editor: r.updated_by ? names.get(r.updated_by as string) ?? "—" : null,
  }));

  const linked = await getLinkedRepo(ctx.room.id);
  const token = await getRoomToken(ctx.room.id);
  if (!token || !linked) {
    return Response.json({ connected: !!token, linked, repo: null, workspace });
  }

  try {
    const { entries, truncated } = await getTree(token, linked.repo, linked.branch);
    const files = entries.filter((e) => e.type === "blob").map((e) => ({ path: e.path, size: e.size ?? 0 }));
    const top = largest(files, 15);
    const commits = await Promise.all(
      top.map((f) => lastCommit(token, linked.repo, linked.branch, f.path).catch(() => null))
    );
    return Response.json({
      connected: true,
      linked,
      repo: {
        truncated,
        files,
        top: top.map((f, i) => ({ ...f, lastAuthor: commits[i]?.author ?? null, lastDate: commits[i]?.date ?? null })),
      },
      workspace,
    });
  } catch (e) {
    return ghErrorResponse(e);
  }
}
