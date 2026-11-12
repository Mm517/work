"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { RoomMember } from "@/lib/types";

/** All members of the room (online or not) with their display names. */
export function useRoomMembers(roomId: string) {
  const [list, setList] = useState<RoomMember[]>([]);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: ms } = await sb.from("room_members").select("user_id, role").eq("room_id", roomId);
    const ids = (ms ?? []).map((m) => m.user_id as string);
    if (!ids.length) return setList([]);
    const { data: ps } = await sb.from("profiles").select("id, display_name").in("id", ids);
    const names = new Map((ps ?? []).map((p) => [p.id as string, p.display_name as string]));
    setList(
      (ms ?? []).map((m) => ({
        id: m.user_id as string,
        role: m.role as "owner" | "member",
        name: names.get(m.user_id as string) || "—",
      }))
    );
  }, [roomId]);

  useEffect(() => {
    void load();
    const sb = getSupabase();
    const ch = sb
      .channel(`members-changes:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
        () => void load()
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [roomId, load]);

  return list;
}
