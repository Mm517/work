"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { ChatMessage } from "@/lib/types";

/** channel key: "room" for the room chat, or the other person's user id for a DM */
export const channelOf = (m: ChatMessage, meId: string) =>
  m.recipient_id === null ? "room" : m.sender_id === meId ? m.recipient_id : m.sender_id;

export function useChat(roomId: string, meId: string, viewing: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;
    void sb
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (err) return setError(err.message);
        setMessages(((data ?? []) as ChatMessage[]).reverse());
      });
    const ch = sb
      .channel(`messages-changes:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        ({ new: row }) => {
          const m = row as ChatMessage;
          setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
          if (m.sender_id !== meId && viewingRef.current !== channelOf(m, meId)) {
            const k = channelOf(m, meId);
            setUnread((u) => ({ ...u, [k]: (u[k] ?? 0) + 1 }));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        ({ old }) => setMessages((cur) => cur.filter((x) => x.id !== (old as { id: string }).id))
      )
      .subscribe();
    return () => {
      alive = false;
      void sb.removeChannel(ch);
    };
  }, [roomId, meId]);

  // opening a channel clears its badge
  useEffect(() => {
    if (viewing) setUnread((u) => (u[viewing] ? { ...u, [viewing]: 0 } : u));
  }, [viewing]);

  const send = useCallback(
    async (channel: string, body: string) => {
      const text = body.trim();
      if (!text) return;
      const { error: err } = await getSupabase()
        .from("messages")
        .insert({ room_id: roomId, body: text, recipient_id: channel === "room" ? null : channel })
        .select()
        .single()
        .then((r) => {
          if (r.data) {
            const m = r.data as ChatMessage;
            setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
          }
          return r;
        });
      if (err) setError(err.message);
    },
    [roomId]
  );

  const remove = useCallback(async (id: string) => {
    const { error: err } = await getSupabase().from("messages").delete().eq("id", id);
    if (err) setError(err.message);
    else setMessages((cur) => cur.filter((m) => m.id !== id));
  }, []);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  return { messages, unread, totalUnread, error, send, remove };
}
