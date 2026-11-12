"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { VoiceRoom } from "@/lib/types";

export function useVoiceRooms(roomId: string) {
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);

  const load = useCallback(async () => {
    const { data } = await getSupabase()
      .from("voice_rooms")
      .select("id, name")
      .eq("room_id", roomId)
      .order("created_at");
    setRooms((data ?? []) as VoiceRoom[]);
  }, [roomId]);

  useEffect(() => {
    void load();
    const sb = getSupabase();
    const ch = sb
      .channel(`voice-changes:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voice_rooms", filter: `room_id=eq.${roomId}` },
        () => void load()
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [roomId, load]);

  const add = useCallback(
    async (name: string) => {
      const n = name.trim().slice(0, 40);
      if (!n) return;
      await getSupabase().from("voice_rooms").insert({ room_id: roomId, name: n });
      await load();
    },
    [roomId, load]
  );

  const remove = useCallback(
    async (id: string) => {
      await getSupabase().from("voice_rooms").delete().eq("id", id);
      await load();
    },
    [load]
  );

  return { rooms, add, remove };
}
