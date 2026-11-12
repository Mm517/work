"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type Notif = {
  id: string;
  room_id: string;
  user_id: string;
  from_user_id: string;
  kind: "ask" | "invite";
  body: string;
  read_at: string | null;
  created_at: string;
};

/** Stored notifications: survive the recipient being offline. Realtime only adds the "live" toast. */
export function useNotifications(roomId: string, meId: string, onLive: (n: Notif) => void) {
  const [items, setItems] = useState<Notif[]>([]);
  const [loaded, setLoaded] = useState(false);
  const liveRef = useRef(onLive);
  liveRef.current = onLive;

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;
    void sb
      .from("notifications")
      .select("*")
      .eq("room_id", roomId)
      .eq("user_id", meId)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (!alive) return;
        setItems((data ?? []) as Notif[]);
        setLoaded(true);
      });
    const ch = sb
      .channel(`notifications:${roomId}:${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${meId}` },
        ({ new: row }) => {
          const n = row as Notif;
          if (n.room_id !== roomId) return;
          setItems((cur) => (cur.some((x) => x.id === n.id) ? cur : [n, ...cur]));
          liveRef.current(n);
        }
      )
      .subscribe();
    return () => {
      alive = false;
      void sb.removeChannel(ch);
    };
  }, [roomId, meId]);

  const markRead = useCallback(async (id: string) => {
    const at = new Date().toISOString();
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read_at: at } : n)));
    await getSupabase().from("notifications").update({ read_at: at }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    const at = new Date().toISOString();
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? at })));
    await getSupabase().from("notifications").update({ read_at: at }).eq("room_id", roomId).eq("user_id", meId).is("read_at", null);
  }, [roomId, meId]);

  const send = useCallback(
    async (to: string, kind: "ask" | "invite", body = "") => {
      const { error } = await getSupabase()
        .from("notifications")
        .insert({ room_id: roomId, user_id: to, kind, body: body.slice(0, 1000) });
      return error?.message ?? null;
    },
    [roomId]
  );

  return { items, loaded, unread: items.filter((n) => !n.read_at), markRead, markAllRead, send };
}
