"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildFolders, fmtSize, type Folder } from "@/lib/structure";
import PushDialog from "@/components/PushDialog";

type Data = {
  connected: boolean;
  linked: { repo: string; branch: string } | null;
  repo: {
    truncated: boolean;
    files: { path: string; size: number }[];
    top: { path: string; size: number; lastAuthor: string | null; lastDate: string | null }[];
  } | null;
  workspace: { path: string; size: number; updatedAt: string; editor: string | null }[];
};

function FolderNode({ f, depth = 0 }: { f: Folder; depth?: number }) {
  return (
    <div style={{ paddingInlineStart: depth ? 14 : 0 }}>
      {f.name && (
        <details open={depth < 2}>
          <summary>
            {f.name} <span className="muted">{f.files} ملف · {fmtSize(f.size)}</span>
          </summary>
          {f.folders.map((c) => <FolderNode key={c.path} f={c} depth={depth + 1} />)}
          {f.leaves.map((l) => (
            <div key={l.path} className="leaf">
              {l.path.split("/").pop()} <span className="muted">{fmtSize(l.size)}</span>
            </div>
          ))}
        </details>
      )}
      {!f.name && (
        <>
          {f.folders.map((c) => <FolderNode key={c.path} f={c} depth={1} />)}
          {f.leaves.map((l) => (
            <div key={l.path} className="leaf">
              {l.path} <span className="muted">{fmtSize(l.size)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function StructurePanel({ room }: { room: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const [repos, setRepos] = useState<{ full_name: string; private: boolean }[] | null>(null);
  const [pick, setPick] = useState("");
  const [pushOpen, setPushOpen] = useState(false);
  const [note, setNote] = useState("");

  const q = encodeURIComponent(room);
  const load = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/github/structure?room=${q}`);
    const j = await res.json();
    if (!res.ok) {
      setReconnect(!!j.reconnect);
      return setError(j.error ?? "فشل التحميل");
    }
    setReconnect(false);
    setData(j as Data);
  }, [q]);

  useEffect(() => {
    void load();
    const gh = new URLSearchParams(location.search).get("github");
    if (gh === "connected") setNote("تم ربط GitHub ✓ دلوقتي اختار المستودع.");
    else if (gh) setNote("فشل ربط GitHub، جرّب تاني.");
  }, [load]);

  useEffect(() => {
    if (data?.connected && !data.linked && !repos) {
      void fetch(`/api/github/repos?room=${q}`).then(async (r) => {
        const j = await r.json();
        if (r.ok) setRepos(j.repos);
        else setError(j.error ?? "");
      });
    }
  }, [data, repos, q]);

  const folders = useMemo(() => (data?.repo ? buildFolders(data.repo.files) : null), [data]);
  const wsFolders = useMemo(() => (data ? buildFolders(data.workspace) : null), [data]);

  async function link() {
    if (!pick) return;
    const res = await fetch("/api/github/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, repo: pick }),
    });
    const j = await res.json();
    if (!res.ok) return setError(j.error ?? "فشل الربط");
    await load();
  }

  const connectBtn = (
    <a className="btn primary" href={`/api/github/connect?room=${q}`}>
      {reconnect ? "أعد ربط GitHub" : "اربط حساب GitHub"}
    </a>
  );

  return (
    <div className="structure">
      <div className="kanban-bar">
        <b>هيكل المشروع</b>
        {data?.linked && (
          <span className="badge" dir="ltr">{data.linked.repo} @ {data.linked.branch}</span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => void load()}>تحديث</button>
        {data?.linked && <button className="btn sm primary" onClick={() => setPushOpen(true)}>ادفع التعديلات لـ GitHub</button>}
      </div>

      <div className="structure-body">
        {note && <div className="muted">{note}</div>}
        {error && <div className="error">{error}</div>}
        {(reconnect || (data && !data.connected)) && <div>{connectBtn}</div>}

        {data?.connected && !data.linked && (
          <div style={{ display: "flex", gap: 6, maxWidth: 420 }}>
            <select className="input" dir="ltr" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— اختار المستودع —</option>
              {(repos ?? []).map((r) => (
                <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? " 🔒" : ""}</option>
              ))}
            </select>
            <button className="btn primary" onClick={link} disabled={!pick}>ربط</button>
          </div>
        )}

        {data?.repo && folders && (
          <div className="grid2" style={{ alignItems: "start" }}>
            <section className="panel-box" dir="ltr">
              <div className="side-title">GitHub · folders</div>
              {data.repo.truncated && <div className="muted">المستودع كبير، الشجرة مقطوعة جزئيًا.</div>}
              <FolderNode f={folders} />
            </section>
            <section className="panel-box">
              <div className="side-title">أكبر الملفات + آخر تعديل (GitHub)</div>
              <table className="tbl" dir="ltr">
                <tbody>
                  {data.repo.top.map((t) => (
                    <tr key={t.path}>
                      <td>{t.path}</td>
                      <td>{fmtSize(t.size)}</td>
                      <td>{t.lastAuthor ?? "—"}</td>
                      <td>{t.lastDate ? new Date(t.lastDate).toLocaleDateString() : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {data && wsFolders && (
          <div className="grid2" style={{ alignItems: "start" }}>
            <section className="panel-box" dir="ltr">
              <div className="side-title">ملفات الغرفة · folders</div>
              <FolderNode f={wsFolders} />
            </section>
            <section className="panel-box">
              <div className="side-title">مين آخر واحد عدّل (داخل المنصة)</div>
              <table className="tbl" dir="ltr">
                <tbody>
                  {[...data.workspace].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((w) => (
                    <tr key={w.path}>
                      <td>{w.path}</td>
                      <td>{fmtSize(w.size)}</td>
                      <td>{w.editor ?? "—"}</td>
                      <td>{new Date(w.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>

      {pushOpen && <PushDialog room={room} onClose={() => setPushOpen(false)} />}
    </div>
  );
}
