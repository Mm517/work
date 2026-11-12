"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { RoomMember } from "@/lib/types";

type Snap = { id: string; content: string; label: string | null; created_by: string | null; created_at: string };

export default function HistoryPanel({
  roomId,
  path,
  members,
  onRestore,
  onClose,
}: {
  roomId: string;
  path: string;
  members: RoomMember[];
  onRestore: (content: string) => void;
  onClose: () => void;
}) {
  const [fileId, setFileId] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: f } = await sb.from("files").select("id").eq("room_id", roomId).eq("path", path).maybeSingle();
    if (!f) return setError("الملف مش موجود");
    setFileId(f.id as string);
    const { data, error: err } = await sb
      .from("file_snapshots")
      .select("id, content, label, created_by, created_at")
      .eq("file_id", f.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (err) return setError(err.message);
    setSnaps((data ?? []) as Snap[]);
  }, [roomId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function snapshotCurrent(lbl: string) {
    if (!fileId) return;
    const sb = getSupabase();
    const { data: cur } = await sb.from("files").select("content").eq("id", fileId).maybeSingle();
    const { data: u } = await sb.auth.getUser();
    const { error: err } = await sb.from("file_snapshots").insert({
      room_id: roomId,
      file_id: fileId,
      content: (cur?.content as string) ?? "",
      label: lbl.slice(0, 100) || "manual",
      created_by: u.user?.id,
    });
    if (err) setError(err.message);
  }

  async function saveNow() {
    await snapshotCurrent(label.trim() || "manual");
    setLabel("");
    await load();
  }

  async function restore(s: Snap) {
    if (!confirm("استرجاع النسخة دي هيبدّل محتوى الملف للكل. هنحفظ نسخة من الحالي الأول. متأكد؟")) return;
    await snapshotCurrent("قبل الاسترجاع");
    onRestore(s.content);
    await load();
  }

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? "—";

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="side-title">
          <span dir="ltr">تاريخ النسخ · {path}</span>
          <button className="btn sm" onClick={onClose}>إغلاق</button>
        </div>
        {error && <div className="error">{error}</div>}
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" placeholder="اسم للنسخة (اختياري)" maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn primary" onClick={saveNow}>احفظ نسخة الآن</button>
        </div>
        <div className="muted">النسخة بتتاخد من آخر حالة اتحفظت في الداتا بيز (بعد ثانية من آخر كتابة). فيه نسخة تلقائية كل 5 دقايق تقريبًا مع التعديل.</div>
        {snaps.length === 0 && <div className="muted">لسه مفيش نسخ.</div>}
        {snaps.map((s) => (
          <div key={s.id} className="snap">
            <div className="row-line" style={{ border: 0 }}>
              <span>
                {new Date(s.created_at).toLocaleString("ar-EG")} · {nameOf(s.created_by)}{" "}
                <span className="badge">{s.label === "auto" ? "تلقائي" : s.label}</span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn sm" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? "إخفاء" : "معاينة"}
                </button>
                <button className="btn sm" onClick={() => void restore(s)}>استرجاع</button>
              </span>
            </div>
            {open === s.id && <pre className="snap-pre" dir="ltr">{s.content.slice(0, 4000)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
