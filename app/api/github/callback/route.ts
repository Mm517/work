import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/github-auth";
import { encryptToken } from "@/lib/crypto";
import { createAdminSupabase } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? origin;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookie = req.cookies.get("kw_gh_state")?.value ?? "";
  const dot = cookie.indexOf(".");
  const expected = cookie.slice(0, dot);
  const slug = cookie.slice(dot + 1);

  const fail = (reason: string) => {
    const r = NextResponse.redirect(`${base}/w/${slug || ""}?github=${reason}`);
    r.cookies.delete({ name: "kw_gh_state", path: "/api/github" });
    return r;
  };
  if (!code || !state || dot < 1 || state !== expected) return fail("state");

  const ctx = await requireOwner(slug);
  if (ctx instanceof Response) return fail("forbidden");

  const clientId = process.env.GITHUB_CLIENT_ID;
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !secret) return fail("config");

  const tokRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: secret, code, redirect_uri: `${base}/api/github/callback` }),
  });
  const tok = (await tokRes.json()) as { access_token?: string };
  if (!tok.access_token) return fail("denied");

  const { error } = await createAdminSupabase()
    .from("github_tokens")
    .upsert({
      room_id: ctx.room.id,
      user_id: ctx.userId,
      token_enc: encryptToken(tok.access_token),
      created_at: new Date().toISOString(),
    });
  if (error) return fail("store");

  const r = NextResponse.redirect(`${base}/w/${slug}?github=connected`);
  r.cookies.delete({ name: "kw_gh_state", path: "/api/github" });
  return r;
}
