"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { randomRoom, slugRoom } from "@/lib/utils";

type MyRoom = { slug: string; name: string; role: string };

export default function Home() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [roomName, setRoomName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return router.replace("/login");
    setUserId(u.user.id);
    const [{ data: p }, { data: m }] = await Promise.all([
      sb.from("profiles").select("display_name").eq("id", u.user.id).maybeSingle(),
      sb.from("room_members").select("role, rooms(slug, name)").eq("user_id", u.user.id),
    ]);
    setName(p?.display_name ?? "");
    type Row = { role: string; rooms: { slug: string; name: string } | { slug: string; name: string }[] | null };
    setRooms(
      ((m ?? []) as Row[]).flatMap((r) => {
        const room = Array.isArray(r.rooms) ? r.rooms[0] : r.rooms;
        return room ? [{ slug: room.slug, name: room.name, role: r.role }] : [];
      })
    );
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveName() {
    if (!userId || name.trim().length < 2) return setError("الاسم حرفين على الأقل");
    const { error: err } = await getSupabase()
      .from("profiles")
      .upsert({ id: userId, display_name: name.trim().slice(0, 40) });
    if (err) return setError(err.message);
    setError("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = roomName.trim();
    const s = slugRoom(slug) || randomRoom();
    if (!n) return setError("اكتب اسم الغرفة");
    if (s.length < 3) return setError("كود الغرفة 3 حروف أو أرقام على الأقل (إنجليزي)");
    const { error: err } = await getSupabase().from("rooms").insert({ slug: s, name: n });
    if (err) return setError(err.code === "23505" ? "كود الغرفة مستخدم، اختار غيره." : err.message);
    router.push(`/w/${s}`);
  }

  async function logout() {
    await getSupabase().auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="home">
      <div className="home-card" style={{ maxWidth: 480 }}>
        <div className="logo">
          كتشنيلي <span>وورك</span>
        </div>

        <label className="field">
          اسمك اللي بيظهر للفريق
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button className="btn" type="button" onClick={saveName}>
              {saved ? "اتحفظ ✓" : "حفظ"}
            </button>
          </div>
        </label>

        <div className="side-title">غرفك</div>
        {rooms.length === 0 ? (
          <div className="muted">لسه مفيش غرف. اعمل غرفة جديدة أو افتح لينك دعوة.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {rooms.map((r) => (
              <Link key={r.slug} className="btn" href={`/w/${r.slug}`}>
                {r.name} <span className="muted" dir="ltr">({r.slug}{r.role === "owner" ? " · owner" : ""})</span>
              </Link>
            ))}
          </div>
        )}

        <form onSubmit={createRoom} style={{ display: "grid", gap: 8 }}>
          <div className="side-title">غرفة جديدة</div>
          <input className="input" placeholder="اسم الغرفة" value={roomName} maxLength={80} onChange={(e) => setRoomName(e.target.value)} />
          <input className="input" dir="ltr" placeholder="كود الغرفة (اختياري) my-team" value={slug} maxLength={64} onChange={(e) => setSlug(e.target.value)} />
          {error && <div className="error">{error}</div>}
          <button className="btn primary" type="submit">إنشاء الغرفة</button>
        </form>

        <button className="btn sm" onClick={logout}>تسجيل الخروج</button>
      </div>
    </main>
  );
}
