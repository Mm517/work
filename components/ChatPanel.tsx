"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, RoomMember } from "@/lib/types";
import { channelOf } from "@/hooks/useChat";

type Props = {
  meId: string;
  members: RoomMember[];
  messages: ChatMessage[];
  unread: Record<string, number>;
  channel: string;
  error: string;
  typingNames: string[];
  onChannel: (c: string) => void;
  onSend: (channel: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTyping: () => void;
};

export default function ChatPanel(p: Props) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const nameOf = (id: string) => p.members.find((m) => m.id === id)?.name ?? "—";
  const list = p.messages.filter((m) => channelOf(m, p.meId) === p.channel);
  const others = p.members.filter((m) => m.id !== p.meId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [list.length, p.channel]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text;
    setText("");
    await p.onSend(p.channel, t);
  }

  const tab = (key: string, label: string) => (
    <button key={key} className={`tab ${p.channel === key ? "on" : ""}`} onClick={() => p.onChannel(key)}>
      {label}
      {p.unread[key] ? <span className="badge-n">{p.unread[key]}</span> : null}
    </button>
  );

  return (
    <div className="chat">
      <div className="chat-tabs">
        {tab("room", "# الغرفة")}
        {others.map((m) => tab(m.id, `✉ ${m.name}`))}
      </div>
      <div className="chat-list">
        {list.length === 0 && <div className="muted">لسه مفيش رسايل.</div>}
        {list.map((m) => (
          <div key={m.id} className={`msg ${m.sender_id === p.meId ? "mine" : ""}`}>
            <div className="msg-head">
              <b>{m.sender_id === p.meId ? "أنت" : nameOf(m.sender_id)}</b>
              <span className="muted">
                {new Date(m.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
              </span>
              {m.sender_id === p.meId && (
                <button className="x-btn" title="حذف" onClick={() => void p.onDelete(m.id)}>✕</button>
              )}
            </div>
            <div className="msg-body">{m.body}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-typing muted">
        {p.typingNames.length > 0 && `${p.typingNames.join("، ")} بيكتب…`}
        {p.error && <span className="error"> {p.error}</span>}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          className="input"
          placeholder={p.channel === "room" ? "اكتب للغرفة…" : `رسالة خاصة لـ ${nameOf(p.channel)}…`}
          maxLength={4000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            p.onTyping();
          }}
        />
        <button className="btn primary" type="submit">إرسال</button>
      </form>
    </div>
  );
}
