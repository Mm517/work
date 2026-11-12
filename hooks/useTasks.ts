"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Priority, Task, TaskStatus } from "@/lib/types";

export type TaskDraft = {
  title: string;
  description: string;
  status: TaskStatus;
  assignee_id: string | null;
  priority: Priority;
  due_date: string | null;
  file_path: string | null;
};

export function useTasks(roomId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .from("tasks")
      .select("*")
      .eq("room_id", roomId)
      .order("position");
    if (err) return setError(err.message);
    setTasks((data ?? []) as Task[]);
  }, [roomId]);

  useEffect(() => {
    void load();
    const sb = getSupabase();
    const ch = sb
      .channel(`tasks-changes:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `room_id=eq.${roomId}` },
        () => void load()
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [roomId, load]);

  const create = useCallback(
    async (d: TaskDraft) => {
      const last = Math.max(0, ...tasks.filter((t) => t.status === d.status).map((t) => t.position));
      const { error: err } = await getSupabase()
        .from("tasks")
        .insert({ ...d, room_id: roomId, position: last + 1024 });
      if (err) setError(err.message);
      else await load();
    },
    [roomId, tasks, load]
  );

  const edit = useCallback(
    async (id: string, d: Partial<TaskDraft>) => {
      const { error: err } = await getSupabase().from("tasks").update(d).eq("id", id);
      if (err) setError(err.message);
      else await load();
    },
    [load]
  );

  /** Drop `id` into column `status`, right before `beforeId` (or at the end). Optimistic. */
  const move = useCallback(
    async (id: string, status: TaskStatus, beforeId: string | null) => {
      const col = tasks
        .filter((t) => t.status === status && t.id !== id)
        .sort((a, b) => a.position - b.position);
      const idx = beforeId ? col.findIndex((t) => t.id === beforeId) : -1;
      let position: number;
      if (idx === -1) position = (col.length ? col[col.length - 1].position : 0) + 1024;
      else if (idx === 0) position = col[0].position / 2;
      else position = (col[idx - 1].position + col[idx].position) / 2;

      setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, status, position } : t)));
      const { error: err } = await getSupabase().from("tasks").update({ status, position }).eq("id", id);
      if (err) {
        setError(err.message);
        await load();
      }
    },
    [tasks, load]
  );

  const remove = useCallback(
    async (id: string) => {
      const { error: err } = await getSupabase().from("tasks").delete().eq("id", id);
      if (err) setError(err.message);
      else await load();
    },
    [load]
  );

  return { tasks, error, create, edit, move, remove };
}
