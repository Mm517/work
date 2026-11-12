"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ensureRealtimeAuth, getSupabase } from "@/lib/supabase";
import type { Me, RoomInfo } from "@/lib/types";
import { usePresence, statusOf, STATUS_LABEL } from "@/hooks/usePresence";
import { useNotifications, type Notif } from "@/hooks/useNotifications";
import SearchPanel from "@/components/SearchPanel";
import HistoryPanel from "@/components/HistoryPanel";
import FileTree from "@/components/FileTree";
import MembersDialog from "@/components/MembersDialog";
import KanbanBoard from "@/components/KanbanBoard";
import ChatPanel from "@/components/ChatPanel";
import StructurePanel from "@/components/StructurePanel";
import { useChat } from "@/hooks/useChat";
import { useVoiceRooms } from "@/hooks/useVoiceRooms";
import { useTasks } from "@/hooks/useTasks";
import { useRoomMembers } from "@/hooks/useRoomMembers";

const CollabEditor = dynamic(() => import("@/components/CollabEditor"), {
  ssr: false,
  loading: () => <div className="empty">بنحمّل المحرر…</div>,
});
const VideoPanel = dynamic(() => import("@/components/VideoPanel"), { ssr: false });
const VoiceSession = dynamic(() => import("@/components/VoiceSession"), { ssr: false });

type Toast = { id: string; kind: "ask" | "invite"; from: string; text?: string };
const IDLE_MS = 2 * 60 * 1000;

const STARTER: Record<string, string> = {
  "README.md": "# مشروعنا\n\nابدأوا الكتابة هنا. كل واحد هيشوف تعديلات التاني لحظيًا.\n",
  "src/index.ts": "export function hello(name: string) {\n  return `Hello, ${name}!`;\n}\n",
};

export default function Workspace(props: { room: RoomInfo; me: Me }) {
  // private realtime channels need the JWT on the socket before anything subscribes
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    ensureRealtimeAuth(getSupabase()).finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  if (!ready) return <div className="empty">…</div>;
  return <WorkspaceInner {...props} />;
}

function WorkspaceInner({ room, me }: { room: RoomInfo; me: Me }) {
  const isOwner = room.ownerId === me.id;
  const [paths, setPaths] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [newFile, setNewFile] = useState("");
  const [askTo, setAskTo] = useState<string | null>(null);
  const [askText, setAskText] = useState("");
  const [error, setError] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [view, setView] = useState<"code" | "tasks" | "chat" | "structure">("code");
  const [chatChannel, setChatChannel] = useState("room");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [newVoice, setNewVoice] = useState("");
  const roomMembers = useRoomMembers(room.id);
  const chat = useChat(room.id, me.id, view === "chat" ? chatChannel : null);
  const voice = useVoiceRooms(room.id);
  const taskApi = useTasks(room.id);
  const currentTask = (uid: string) =>
    taskApi.tasks.find((t) => t.assignee_id === uid && t.status === "doing")?.title ?? null;
  const openFile = (p: string) => {
    setActive(p);
    setView("code");
  };

  const { members, update: updatePresence } = usePresence(room.id, me);

  // stored notifications (ask / invite): delivered live when online, kept for later when offline
  const nameRef = useRef<(id: string) => string>(() => "—");
  nameRef.current = (id) => roomMembers.find((m) => m.id === id)?.name ?? "—";
  const toastFor = useCallback(
    (n: Notif) => ({ id: n.id, kind: n.kind, from: nameRef.current(n.from_user_id), text: n.body }),
    []
  );
  const notifs = useNotifications(room.id, me.id, (n) => setToasts((t) => [...t, toastFor(n)]));
  const [bellOpen, setBellOpen] = useState(false);
  const shownUnread = useRef(false);
  useEffect(() => {
    // unread items that arrived while I was away show up once as toasts
    if (!notifs.loaded || shownUnread.current || roomMembers.length === 0) return;
    shownUnread.current = true;
    setToasts((t) => [...t, ...notifs.unread.slice(0, 3).map(toastFor)]);
  }, [notifs.loaded, notifs.unread, roomMembers.length, toastFor]);

  // idle ("بعيد"): no input for 2 min or tab hidden
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      updatePresence({ idle: document.hidden });
      clearTimeout(timer);
      timer = setTimeout(() => updatePresence({ idle: true }), IDLE_MS);
    };
    const evs = ["mousemove", "keydown", "pointerdown", "visibilitychange"] as const;
    evs.forEach((e) => window.addEventListener(e, reset));
    document.addEventListener("visibilitychange", reset);
    reset();
    return () => {
      clearTimeout(timer);
      evs.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", reset);
    };
  }, [updatePresence]);

  // "typing now" indicator (cleared 2.5s after the last keystroke)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markTyping = useCallback(
    (kind: string) => {
      updatePresence({ typing: kind });
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => updatePresence({ typing: null }), 2500);
    },
    [updatePresence]
  );

  // history: restore a snapshot into the live document
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restore, setRestore] = useState<{ nonce: number; content: string } | null>(null);

  // files list + realtime (postgres_changes obey RLS)
  const loadFiles = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .from("files")
      .select("path")
      .eq("room_id", room.id)
      .order("path");
    if (err) return setError(err.message);
    setPaths((data ?? []).map((r) => r.path as string));
  }, [room.id]);

  useEffect(() => {
    const sb = getSupabase();
    void loadFiles();
    const ch = sb
      .channel(`files-changes:${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "files", filter: `room_id=eq.${room.id}` },
        () => void loadFiles()
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [room.id, loadFiles]);

  // voice room / meeting state is shared through presence (also drives "في ميتنج")
  useEffect(() => {
    updatePresence({ voice: voiceId, meeting: videoOpen });
  }, [voiceId, videoOpen, updatePresence]);

  function joinVoice(id: string) {
    setVideoOpen(false); // one live audio session at a time
    setVoiceId(id);
  }
  function toggleMeeting() {
    if (!videoOpen) setVoiceId(null);
    setVideoOpen((v) => !v);
  }

  // tell others which file I'm on
  useEffect(() => {
    updatePresence({ file: active });
  }, [active, updatePresence]);

  async function createFile(raw: string, content = "") {
    const path = raw.trim().replace(/^\/+/, "").replace(/\s+/g, "-");
    if (!path || path.endsWith("/")) return;
    const { error: err } = await getSupabase()
      .from("files")
      .upsert({ room_id: room.id, path, content }, { onConflict: "room_id,path", ignoreDuplicates: true });
    if (err) return setError(err.message);
    setNewFile("");
    await loadFiles();
    setActive(path);
  }

  async function seedStarter() {
    for (const [p, c] of Object.entries(STARTER)) {
      await getSupabase()
        .from("files")
        .upsert({ room_id: room.id, path: p, content: c }, { onConflict: "room_id,path", ignoreDuplicates: true });
    }
    await loadFiles();
    setActive("README.md");
  }

  async function deleteFile(path: string) {
    if (!confirm(`حذف ${path}؟ ده هيمسحه للكل.`)) return;
    const { error: err } = await getSupabase().from("files").delete().eq("room_id", room.id).eq("path", path);
    if (err) return setError(err.message);
    if (active === path) setActive(null);
    await loadFiles();
  }

  async function sendPing(to: string, kind: "ask" | "invite", text?: string) {
    const err = await notifs.send(to, kind, text ?? "");
    if (err) setError(err);
  }

  function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    if (askTo && askText.trim()) void sendPing(askTo, "ask", askText.trim());
    setAskTo(null);
    setAskText("");
  }

  const others = members.filter((m) => m.id !== me.id);
  const offline = roomMembers.filter((rm) => rm.id !== me.id && !members.some((m) => m.id === rm.id));
  const myMeta = members.find((m) => m.id === me.id);
  const myStatus = statusOf({ meeting: videoOpen, voice: voiceId, idle: myMeta?.idle ?? false });
  const dismissToast = (id: string) => {
    setToasts((x) => x.filter((y) => y.id !== id));
    void notifs.markRead(id);
  };

  return (
    <div className="ws">
      <header className="ws-head">
        <div className="logo" style={{ fontSize: 18 }}>
          كتشنيلي <span>وورك</span>
        </div>
        <span className="room-chip" title={room.slug}>{room.name}</span>
        {isOwner && (
          <button className="btn sm" onClick={() => setMembersOpen(true)}>
            الأعضاء والدعوات
          </button>
        )}
        <div className="spacer" />
        <span className="muted">{members.length} متصل</span>
        <div className="bell">
          <button className="btn" onClick={() => setBellOpen((o) => !o)}>
            🔔{notifs.unread.length > 0 && <span className="badge-n">{notifs.unread.length}</span>}
          </button>
          {bellOpen && (
            <div className="bell-panel">
              <div className="side-title">
                <span>الإشعارات</span>
                <button className="btn sm" onClick={() => void notifs.markAllRead()}>تحديد الكل كمقروء</button>
              </div>
              {notifs.items.length === 0 && <div className="muted">مفيش إشعارات.</div>}
              {notifs.items.map((n) => (
                <div key={n.id} className={`notif ${n.read_at ? "" : "unread"}`}>
                  <div>
                    <b>{nameRef.current(n.from_user_id)}</b>{" "}
                    {n.kind === "ask" ? `بيسألك: ${n.body}` : "عزمك على ميتنج"}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{new Date(n.created_at).toLocaleString("ar-EG")}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {n.kind === "invite" && (
                      <button
                        className="btn sm primary"
                        onClick={() => {
                          setVoiceId(null);
                          setVideoOpen(true);
                          setBellOpen(false);
                          void notifs.markRead(n.id);
                        }}
                      >
                        انضم
                      </button>
                    )}
                    {!n.read_at && <button className="btn sm" onClick={() => void notifs.markRead(n.id)}>تم</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className={`btn ${videoOpen ? "" : "primary"}`}
          onClick={toggleMeeting}
        >
          {videoOpen ? "إغلاق الميتنج" : "ميتنج فيديو"}
        </button>
      </header>

      <div className={`ws-body ${videoOpen ? "with-video" : ""}`}>
        <aside className="side">
          <div className="side-section">
            <div className="side-title">
              <span>الملفات</span>
            </div>
            <SearchPanel roomId={room.id} onOpen={openFile} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createFile(newFile);
              }}
              style={{ display: "flex", gap: 6, marginBottom: 8 }}
            >
              <input
                className="input"
                dir="ltr"
                placeholder="src/app.ts"
                value={newFile}
                onChange={(e) => setNewFile(e.target.value)}
              />
              <button className="btn sm" type="submit">+</button>
            </form>
            {paths.length === 0 ? (
              <div className="muted" style={{ display: "grid", gap: 8 }}>
                <span>الغرفة فاضية.</span>
                <button className="btn sm" onClick={seedStarter}>ابدأ بملفات تجريبية</button>
              </div>
            ) : (
              <FileTree
                paths={paths}
                active={active}
                members={members}
                meId={me.id}
                onOpen={openFile}
                onDelete={deleteFile}
              />
            )}
          </div>

          <div className="side-section voice">
            <div className="side-title">
              <span>الرومات الصوتية</span>
            </div>
            {voiceId && (
              <VoiceSession
                key={voiceId}
                room={room.slug}
                voiceRoomId={voiceId}
                name={voice.rooms.find((v) => v.id === voiceId)?.name ?? ""}
                onLeave={() => setVoiceId(null)}
              />
            )}
            <div className="voice-list">
              {voice.rooms.map((v) => {
                const people = members.filter((m) => m.voice === v.id);
                return (
                  <div key={v.id} className={`voice-room ${voiceId === v.id ? "on" : ""}`}>
                    <div className="voice-head">
                      <span className="nm">🔊 {v.name}</span>
                      {voiceId === v.id ? (
                        <button className="btn sm danger" onClick={() => setVoiceId(null)}>خروج</button>
                      ) : (
                        <button className="btn sm" onClick={() => joinVoice(v.id)}>دخول</button>
                      )}
                      {isOwner && (
                        <button className="x-btn" style={{ opacity: 1 }} title="حذف الروم" onClick={() => void voice.remove(v.id)}>
                          ✕
                        </button>
                      )}
                    </div>
                    {people.length > 0 && (
                      <div className="voice-people">
                        {people.map((m) => (
                          <span key={m.id}>
                            <span className="dot" style={{ background: m.color, display: "inline-block", marginInlineEnd: 6 }} />
                            {m.id === me.id ? `${m.name} (أنت)` : m.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {isOwner && (
              <form
                style={{ display: "flex", gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void voice.add(newVoice);
                  setNewVoice("");
                }}
              >
                <input className="input" placeholder="روم صوتي جديد" maxLength={40} value={newVoice} onChange={(e) => setNewVoice(e.target.value)} />
                <button className="btn sm" type="submit">+</button>
              </form>
            )}
          </div>

          <div className="side-section members">
            <div className="side-title">
              <span>المتصلين الآن</span>
            </div>
            <div className={`member st-${myStatus}`}>
              <div className="member-top">
                <div className="avatar" style={{ background: me.color }}>{me.name[0]}</div>
                <div className="member-info">
                  <div className="member-name">{me.name} (أنت)</div>
                  <div className="member-status">{STATUS_LABEL[myStatus]}</div>
                  <div className="member-file">{active ?? "—"}</div>
                  {currentTask(me.id) && <div className="member-task">🎯 {currentTask(me.id)}</div>}
                </div>
              </div>
            </div>
            {others.map((m) => (
              <div className={`member st-${statusOf(m)}`} key={m.id}>
                <div className="member-top">
                  <div className="avatar" style={{ background: m.color }}>{m.name[0]}</div>
                  <div className="member-info">
                    <div className="member-name">{m.name}</div>
                    <div className="member-status">{STATUS_LABEL[statusOf(m)]}</div>
                    {m.typing === "file" && <div className="member-typing">✍ بيكتب الآن</div>}
                    <div className="member-file">{m.file ?? "مش فاتح ملف"}</div>
                    {currentTask(m.id) && <div className="member-task">🎯 {currentTask(m.id)}</div>}
                  </div>
                </div>
                <div className="member-actions">
                  {m.file && (
                    <button className="btn sm" onClick={() => openFile(m.file!)}>شوف شغله</button>
                  )}
                  <button className="btn sm" onClick={() => setAskTo(askTo === m.id ? null : m.id)}>
                    سؤال
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => {
                      void sendPing(m.id, "invite");
                      setVoiceId(null);
                      setVideoOpen(true);
                    }}
                  >
                    ميتنج معاه
                  </button>
                </div>
                {askTo === m.id && (
                  <form onSubmit={submitAsk} style={{ display: "flex", gap: 6 }}>
                    <input
                      className="input"
                      autoFocus
                      placeholder={`اسأل ${m.name}…`}
                      value={askText}
                      onChange={(e) => setAskText(e.target.value)}
                    />
                    <button className="btn sm primary" type="submit">إرسال</button>
                  </form>
                )}
              </div>
            ))}
            {offline.map((m) => (
              <div className="member" key={m.id} style={{ opacity: 0.7 }}>
                <div className="member-top">
                  <div className="avatar" style={{ background: "#444" }}>{m.name[0]}</div>
                  <div className="member-info">
                    <div className="member-name">{m.name}</div>
                    <div className="member-status">غير متصل · السؤال هيوصله أول ما يدخل</div>
                  </div>
                </div>
                <div className="member-actions">
                  <button className="btn sm" onClick={() => setAskTo(askTo === m.id ? null : m.id)}>سؤال</button>
                </div>
                {askTo === m.id && (
                  <form onSubmit={submitAsk} style={{ display: "flex", gap: 6 }}>
                    <input className="input" autoFocus placeholder={`اسأل ${m.name}…`} value={askText} onChange={(e) => setAskText(e.target.value)} />
                    <button className="btn sm primary" type="submit">إرسال</button>
                  </form>
                )}
              </div>
            ))}
            {others.length === 0 && offline.length === 0 && (
              <div className="muted">مفيش حد تاني دلوقتي. ابعت لينك الدعوة.</div>
            )}
          </div>
        </aside>

        <section className="main">
          <div className="tabbar">
            <div className="tabs">
              <button className={`tab ${view === "code" ? "on" : ""}`} onClick={() => setView("code")}>الكود</button>
              <button className={`tab ${view === "tasks" ? "on" : ""}`} onClick={() => setView("tasks")}>
                التاسكات
              </button>
              <button className={`tab ${view === "chat" ? "on" : ""}`} onClick={() => setView("chat")}>
                الشات{chat.totalUnread ? <span className="badge-n">{chat.totalUnread}</span> : null}
              </button>
              {isOwner && (
                <button className={`tab ${view === "structure" ? "on" : ""}`} onClick={() => setView("structure")}>
                  هيكل المشروع
                </button>
              )}
            </div>
            {view === "code" && <span>{active ?? "اختار ملف من الشجرة"}</span>}
            {view === "code" && active && (
              <button className="btn sm" onClick={() => setHistoryOpen(true)}>تاريخ النسخ</button>
            )}
            {error && <span className="error">{error}</span>}
          </div>
          <div className="view">
            <div className="editor-wrap" style={{ display: view === "code" ? undefined : "none" }}>
              {active ? (
                <CollabEditor key={active} roomId={room.id} path={active} me={me} onTyping={() => markTyping("file")} restore={restore} />
              ) : (
                <div className="empty">اختار ملف أو اعمل ملف جديد وابدأ الكتابة مع فريقك.</div>
              )}
            </div>
            {view === "structure" && isOwner && <StructurePanel room={room.slug} />}
            {view === "chat" && (
              <ChatPanel
                meId={me.id}
                members={roomMembers}
                messages={chat.messages}
                unread={chat.unread}
                channel={chatChannel}
                error={chat.error}
                typingNames={members
                  .filter((m) =>
                    m.id !== me.id &&
                    (chatChannel === "room" ? m.typing === "chat" : m.id === chatChannel && m.typing === `dm:${me.id}`)
                  )
                  .map((m) => m.name)}
                onChannel={setChatChannel}
                onSend={chat.send}
                onDelete={chat.remove}
                onTyping={() => markTyping(chatChannel === "room" ? "chat" : `dm:${chatChannel}`)}
              />
            )}
            {view === "tasks" && (
              <KanbanBoard
                tasks={taskApi.tasks}
                members={roomMembers}
                paths={paths}
                meId={me.id}
                error={taskApi.error}
                onCreate={taskApi.create}
                onEdit={taskApi.edit}
                onMove={taskApi.move}
                onRemove={taskApi.remove}
                onOpenFile={openFile}
              />
            )}
          </div>
        </section>

        {videoOpen && (
          <section className="video">
            <VideoPanel room={room.slug} me={me} onClose={() => setVideoOpen(false)} />
          </section>
        )}
      </div>

      {historyOpen && active && (
        <HistoryPanel
          roomId={room.id}
          path={active}
          members={roomMembers}
          onRestore={(content) => setRestore({ nonce: Date.now(), content })}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {membersOpen && <MembersDialog room={room} meId={me.id} onClose={() => setMembersOpen(false)} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.kind === "ask" ? (
              <div>
                <b>{t.from}</b> بيسألك: {t.text}
              </div>
            ) : (
              <div>
                <b>{t.from}</b> بيعزمك على ميتنج
              </div>
            )}
            <div className="row">
              {t.kind === "invite" && (
                <button
                  className="btn sm primary"
                  onClick={() => {
                    setVoiceId(null);
                    setVideoOpen(true);
                    dismissToast(t.id);
                  }}
                >
                  انضم
                </button>
              )}
              <button
                className="btn sm"
                onClick={() => dismissToast(t.id)}
              >
                إغلاق
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
