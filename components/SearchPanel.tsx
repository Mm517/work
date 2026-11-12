"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Hit = { path: string; line_no: number; snippet: string };

export default function SearchPanel({ roomId, onOpen }: { roomId: string; onOpen: (path: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setError("");
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      const { data, error: err } = await getSupabase().rpc("search_files", { p_room: roomId, p_q: term });
      setBusy(false);
      if (err) return setError(err.message);
      setError("");
      setHits((data ?? []) as Hit[]);
    }, 300);
    return () => clearTimeout(t);
  }, [q, roomId]);

  return (
    <div style={{ marginBottom: 8 }}>
      <input
        className="input"
        dir="ltr"
        placeholder="بحث في الملفات والمحتوى…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      {q.trim().length >= 2 && (
        <div className="search-hits" dir="ltr">
          {busy && <div className="muted">…</div>}
          {!busy && hits.length === 0 && <div className="muted">مفيش نتايج</div>}
          {hits.map((h, i) => (
            <button key={`${h.path}:${h.line_no}:${i}`} className="hit" onClick={() => onOpen(h.path)}>
              <span>{h.path}{h.line_no ? `:${h.line_no}` : ""}</span>
              {h.snippet && <span className="muted">{h.snippet.trim()}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
