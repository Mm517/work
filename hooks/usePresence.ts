"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { presenceTopic } from "@/lib/utils";
import type { Me } from "@/lib/types";

export type PresenceMeta = {
  name: string;
  color: string;
  file: string | null;
  voice: string | null; // voice room id
  meeting: boolean;
  idle: boolean;
  /** null | "file" | "chat" | "dm:<userId>" */
  typing: string | null;
};
export type Member = PresenceMeta & { id: string };

export type Status = "meeting" | "voice" | "away" | "online";
export const statusOf = (m: Pick<PresenceMeta, "meeting" | "voice" | "idle">): Status =>
  m.meeting ? "meeting" : m.voice ? "voice" : m.idle ? "away" : "online";
export const STATUS_LABEL: Record<Status, string> = {
  meeting: "في ميتنج",
  voice: "في روم صوتي",
  away: "بعيد",
  online: "متصل",
};

/** Presence over a private channel: who's online + what they're doing. */
export function usePresence(roomId: string, me: Me) {
  const [members, setMembers] = useState<Member[]>([]);
  const chRef = useRef<RealtimeChannel | null>(null);
  const readyRef = useRef(false);
  const metaRef = useRef<PresenceMeta>({
    name: me.name,
    color: me.color,
    file: null,
    voice: null,
    meeting: false,
    idle: false,
    typing: null,
  });

  const update = useCallback((patch: Partial<PresenceMeta>) => {
    const next = { ...metaRef.current, ...patch };
    const changed = (Object.keys(next) as (keyof PresenceMeta)[]).some(
      (k) => next[k] !== metaRef.current[k]
    );
    metaRef.current = next;
    if (changed && readyRef.current && chRef.current) void chRef.current.track(next);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    const ch = sb.channel(presenceTopic(roomId), {
      config: { private: true, presence: { key: me.id } },
    });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<PresenceMeta>();
      setMembers(
        Object.entries(state).flatMap(([id, metas]) =>
          metas.length ? [{ id, ...metas[metas.length - 1] }] : []
        )
      );
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        readyRef.current = true;
        await ch.track(metaRef.current);
      }
    });
    chRef.current = ch;
    return () => {
      readyRef.current = false;
      chRef.current = null;
      void sb.removeChannel(ch);
    };
  }, [roomId, me.id]);

  return { members, update };
}
