import type { NextRequest } from "next/server";
import { getRoomToken, ghErrorResponse, requireOwner } from "@/lib/github-auth";
import { listRepos } from "@/lib/github";

export async function GET(req: NextRequest) {
  const ctx = await requireOwner(req.nextUrl.searchParams.get("room"));
  if (ctx instanceof Response) return ctx;
  try {
    const token = await getRoomToken(ctx.room.id);
    if (!token) return Response.json({ error: "GitHub مش مربوط", reconnect: true }, { status: 409 });
    const repos = await listRepos(token);
    return Response.json({
      repos: repos.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch, private: r.private })),
    });
  } catch (e) {
    return ghErrorResponse(e);
  }
}
