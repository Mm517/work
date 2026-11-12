import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/github-auth";

export async function GET(req: NextRequest) {
  const ctx = await requireOwner(req.nextUrl.searchParams.get("room"));
  if (ctx instanceof Response) return ctx;
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return Response.json({ error: "GITHUB_CLIENT_ID غير مضبوط" }, { status: 500 });

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;
  const state = randomBytes(24).toString("base64url");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${base}/api/github/callback`);
  url.searchParams.set("scope", "repo");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("kw_gh_state", `${state}.${ctx.room.slug}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/github",
  });
  return res;
}
