"use client";

import { useEffect, useState } from "react";

type Change = { path: string; status: "new" | "modified" };

export default function PushDialog({ room, onClose }: { room: string; onClose: () => void }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [meta, setMeta] = useState<{ repo: string; branch: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("Update from Kitchenly Work");
  const [mode, setMode] = useState<"pr" | "commit">("pr");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ branch: string; files: number; commitUrl: string; prUrl: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/github/push?room=${encodeURIComponent(room)}`);
      const j = await res.json();
      if (!res.ok) return setError(j.error ?? "فشل تحميل التغييرات");
      setMeta({ repo: j.repo, branch: j.branch });
      setChanges(j.changes as Change[]);
      setPicked(new Set((j.changes as Change[]).map((c) => c.path)));
    })().catch((e) => setError(String(e)));
  }, [room]);

  async function push() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, paths: [...picked], message, mode, confirm: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "فشل الدفع");
      setDone(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="side-title">
          <span>ادفع التعديلات لـ GitHub</span>
          <button className="btn sm" onClick={onClose}>إغلاق</button>
        </div>
        {error && <div className="error">{error}</div>}

        {done ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div>اتدفع {done.files} ملف على فرع جديد <b dir="ltr">{done.branch}</b> ✓</div>
            <a className="btn" href={done.commitUrl} target="_blank" rel="noreferrer">فتح الـ commit</a>
            {done.prUrl && <a className="btn primary" href={done.prUrl} target="_blank" rel="noreferrer">فتح الـ Pull Request</a>}
          </div>
        ) : !changes ? (
          !error && <div className="muted">بنقارن الملفات بالمستودع…</div>
        ) : changes.length === 0 ? (
          <div className="muted">كل ملفات الغرفة مطابقة للمستودع، مفيش حاجة تتدفع.</div>
        ) : (
          <>
            <div className="muted">
              المستودع <b dir="ltr">{meta?.repo}</b> · الفرع الأساسي <b dir="ltr">{meta?.branch}</b>. الدفع بيتم دايمًا على
              فرع جديد، مش على الأساسي. الإضافة والتعديل بس، الحذف مش بيتدفع.
            </div>
            {changes.map((c) => (
              <label key={c.path} className="check" dir="ltr">
                <input
                  type="checkbox"
                  checked={picked.has(c.path)}
                  onChange={(e) => {
                    const n = new Set(picked);
                    if (e.target.checked) n.add(c.path);
                    else n.delete(c.path);
                    setPicked(n);
                  }}
                />
                {c.path} <span className="badge">{c.status === "new" ? "جديد" : "معدّل"}</span>
              </label>
            ))}
            <input className="input" value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} placeholder="رسالة الـ commit" />
            <label className="check">
              <input type="radio" checked={mode === "pr"} onChange={() => setMode("pr")} /> افتح Pull Request
            </label>
            <label className="check">
              <input type="radio" checked={mode === "commit"} onChange={() => setMode("commit")} /> commit على فرع جديد بس
            </label>
            <label className="check">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              أؤكد دفع {picked.size} ملف لـ GitHub بحسابي
            </label>
            <button className="btn primary" disabled={!confirm || busy || picked.size === 0 || message.trim().length < 3} onClick={push}>
              {busy ? "بيتدفع…" : "ادفع"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
