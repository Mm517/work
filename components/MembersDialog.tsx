"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { RoomInfo } from "@/lib/types";

type M = { user_id: string; role: string; name: string };
type Inv = { id: string; token: string; expires_at: string; max_uses: number | null; uses: number };

export default function MembersDialog({
  room,
  meId,
  onClose,
}: {
  room: RoomInfo;
  meId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<M[]>([]);
  const [invites, setInvites] = useState<Inv[]>([]);
  const [maxUses, setMaxUses] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: ms, error: e1 } = await sb
      .from("room_members")
      .select("user_id, role")
      .eq("room_id", room.id);
    if (e1) return setError(e1.message);
    const ids = (ms ?? []).map((m) => m.user_id as string);
    const { data: ps } = await sb.from("profiles").select("id, display_name").in("id", ids);
    const names = new Map((ps ?? []).map((p) => [p.id as string, p.display_name as string]));
    setMembers(
      (ms ?? []).map((m) => ({
        user_id: m.user_id as string,
        role: m.role as string,
        name: names.get(m.user_id as string) || "—",
      }))
    );
    const { data: inv } = await sb
      .from("room_invites")
      .select("id, token, expires_at, max_uses, uses")
      .eq("room_id", room.id)
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    setInvites((inv ?? []) as Inv[]);
  }, [room.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(m: M) {
    if (!confirm(`شيل ${m.name} من الغرفة؟ مش هيقدر يرجع بنفس لينك الدعوة.`)) return;
    const { error: err } = await getSupabase()
      .from("room_members")
      .delete()
      .eq("room_id", room.id)
      .eq("user_id", m.user_id);
    if (err) return setError(err.message);
    await load();
  }

  async function createInvite() {
    const n = maxUses.trim() ? Number(maxUses) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1)) return setError("عدد الاستخدامات لازم رقم صحيح أكبر من 0");
    const { error: err } = await getSupabase()
      .from("room_invites")
      .insert({ room_id: room.id, max_uses: n });
    if (err) return setError(err.message);
    setMaxUses("");
    await load();
  }

  async function revoke(id: string) {
    const { error: err } = await getSupabase().from("room_invites").update({ revoked: true }).eq("id", id);
    if (err) return setError(err.message);
    await load();
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/invite/${token}`);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="side-title">
          <span>الأعضاء والدعوات</span>
          <button className="btn sm" onClick={onClose}>إغلاق</button>
        </div>
        {error && <div className="error">{error}</div>}

        <div className="side-title">الأعضاء</div>
        {members.map((m) => (
          <div key={m.user_id} className="row-line">
            <span>
              {m.name} {m.role === "owner" && <span className="muted">(owner)</span>}
              {m.user_id === meId && <span className="muted"> (أنت)</span>}
            </span>
            {m.role !== "owner" && (
              <button className="btn sm danger" onClick={() => remove(m)}>إزالة</button>
            )}
          </div>
        ))}

        <div className="side-title" style={{ marginTop: 14 }}>لينكات الدعوة (صالحة 7 أيام)</div>
        {invites.map((i) => (
          <div key={i.id} className="row-line">
            <span className="muted" dir="ltr">
              …{i.token.slice(-6)} · {i.uses}/{i.max_uses ?? "∞"}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn sm" onClick={() => copy(i.token)}>
                {copied === i.token ? "اتنسخ ✓" : "نسخ اللينك"}
              </button>
              <button className="btn sm danger" onClick={() => revoke(i.id)}>إلغاء</button>
            </span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input
            className="input"
            dir="ltr"
            inputMode="numeric"
            placeholder="أقصى عدد استخدامات (اختياري)"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
          <button className="btn primary" onClick={createInvite}>لينك جديد</button>
        </div>
      </div>
    </div>
  );
}
