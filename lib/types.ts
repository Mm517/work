export type RoomInfo = { id: string; slug: string; name: string; ownerId: string };
export type Me = { id: string; name: string; color: string };

/** Only allow same-site relative redirects. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export type TaskStatus = "todo" | "doing" | "review" | "done";
export type Priority = "low" | "medium" | "high";
export type Task = {
  id: string;
  room_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee_id: string | null;
  priority: Priority;
  due_date: string | null;
  file_path: string | null;
  position: number;
  created_by: string;
};
export type RoomMember = { id: string; name: string; role: "owner" | "member" };

export type ChatMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  recipient_id: string | null;
  body: string;
  created_at: string;
};
export type VoiceRoom = { id: string; name: string };
