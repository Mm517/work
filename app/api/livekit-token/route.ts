import { AccessToken, TrackSource } from "livekit-server-sdk";
import { createServerSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

const SLUG = /^[a-z0-9_-]{3,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(req: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return Response.json(
      { error: "LiveKit غير مضبوط: ضيف LIVEKIT_API_KEY و LIVEKIT_API_SECRET" },
      { status: 500 }
    );
  }

  let body: { room?: string; kind?: "meeting" | "voice"; voiceRoomId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  if (!body.room || !SLUG.test(body.room)) {
    return Response.json({ error: "بيانات ناقصة أو غير صالحة" }, { status: 400 });
  }

  // identity comes from the verified session, never from the request body
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "لازم تسجّل دخول" }, { status: 401 });

  // RLS returns the room only to its members
  const { data: room } = await supabase.from("rooms").select("id").eq("slug", body.room).maybeSingle();
  if (!room) return Response.json({ error: "مش عضو في الغرفة دي" }, { status: 403 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const kind = body.kind === "voice" ? "voice" : "meeting";
  let livekitRoom = `kw-${room.id}-meeting`;
  if (kind === "voice") {
    if (!body.voiceRoomId || !UUID.test(body.voiceRoomId)) {
      return Response.json({ error: "روم صوتي غير صالح" }, { status: 400 });
    }
    // RLS again: only voice rooms of a room the caller belongs to are visible
    const { data: vr } = await supabase
      .from("voice_rooms")
      .select("id")
      .eq("id", body.voiceRoomId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (!vr) return Response.json({ error: "الروم الصوتي مش موجود" }, { status: 404 });
    livekitRoom = `kw-${room.id}-voice-${vr.id}`;
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: (profile?.display_name || user.email?.split("@")[0] || "user").slice(0, 40),
    ttl: "2h",
  });
  at.addGrant({
    roomJoin: true,
    room: livekitRoom,
    canPublish: true,
    canSubscribe: true,
    // voice rooms are audio-only: the server refuses camera/screen tracks
    ...(kind === "voice" ? { canPublishSources: [TrackSource.MICROPHONE] } : {}),
  });

  return Response.json({ token: await at.toJwt() });
}
