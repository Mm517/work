"use client";

import { useState } from "react";
import type { Priority, RoomMember, Task, TaskStatus } from "@/lib/types";
import type { TaskDraft } from "@/hooks/useTasks";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];
const PRIORITY_LABEL: Record<Priority, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية" };

type Props = {
  tasks: Task[];
  members: RoomMember[];
  paths: string[];
  meId: string;
  error: string;
  onCreate: (d: TaskDraft) => Promise<void>;
  onEdit: (id: string, d: Partial<TaskDraft>) => Promise<void>;
  onMove: (id: string, status: TaskStatus, beforeId: string | null) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onOpenFile: (path: string) => void;
};

const emptyDraft = (status: TaskStatus): TaskDraft => ({
  title: "",
  description: "",
  status,
  assignee_id: null,
  priority: "medium",
  due_date: null,
  file_path: null,
});

export default function KanbanBoard(p: Props) {
  const [onlyMine, setOnlyMine] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: TaskDraft } | null>(null);

  const nameOf = (id: string | null) => p.members.find((m) => m.id === id)?.name ?? null;
  const visible = p.tasks.filter((t) => !onlyMine || t.assignee_id === p.meId);
  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    if (!editing) return;
    const d = { ...editing.draft, title: editing.draft.title.trim() };
    if (!d.title) return;
    if (editing.id) await p.onEdit(editing.id, d);
    else await p.onCreate(d);
    setEditing(null);
  }

  return (
    <div className="kanban">
      <div className="kanban-bar">
        <label className="check">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          تاسكاتي بس
        </label>
        <button className="btn sm primary" onClick={() => setEditing({ id: null, draft: emptyDraft("todo") })}>
          + تاسك جديد
        </button>
        {p.error && <span className="error">{p.error}</span>}
      </div>

      <div className="kanban-cols">
        {COLUMNS.map((col) => {
          const items = visible.filter((t) => t.status === col.key).sort((a, b) => a.position - b.position);
          return (
            <div
              key={col.key}
              className={`kcol ${overCol === col.key ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.key);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                if (dragId) void p.onMove(dragId, col.key, null);
                setDragId(null);
              }}
            >
              <div className="kcol-title">
                {col.label} <span className="muted">{items.length}</span>
              </div>
              {items.map((t) => (
                <div
                  key={t.id}
                  className={`kcard prio-${t.priority} ${dragId === t.id ? "dragging" : ""}`}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOverCol(null);
                    if (dragId && dragId !== t.id) void p.onMove(dragId, col.key, t.id);
                    setDragId(null);
                  }}
                  onClick={() =>
                    setEditing({
                      id: t.id,
                      draft: {
                        title: t.title,
                        description: t.description,
                        status: t.status,
                        assignee_id: t.assignee_id,
                        priority: t.priority,
                        due_date: t.due_date,
                        file_path: t.file_path,
                      },
                    })
                  }
                >
                  <div className="kcard-title">{t.title}</div>
                  <div className="kcard-meta">
                    <span className={`badge prio-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                    {nameOf(t.assignee_id) && <span className="badge">👤 {nameOf(t.assignee_id)}</span>}
                    {t.due_date && (
                      <span className={`badge ${t.due_date < today && t.status !== "done" ? "late" : ""}`}>
                        📅 {t.due_date}
                      </span>
                    )}
                    {t.file_path && (
                      <button
                        className="badge link"
                        dir="ltr"
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onOpenFile(t.file_path!);
                        }}
                      >
                        📄 {t.file_path}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button className="btn sm kadd" onClick={() => setEditing({ id: null, draft: emptyDraft(col.key) })}>
                + إضافة
              </button>
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="modal-back" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="side-title">{editing.id ? "تعديل التاسك" : "تاسك جديد"}</div>
            <input
              className="input"
              autoFocus
              placeholder="العنوان"
              maxLength={200}
              value={editing.draft.title}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })}
            />
            <textarea
              className="input"
              rows={4}
              placeholder="الوصف"
              maxLength={5000}
              value={editing.draft.description}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, description: e.target.value } })}
            />
            <div className="grid2">
              <label className="field">
                الحالة
                <select
                  className="input"
                  value={editing.draft.status}
                  onChange={(e) =>
                    setEditing({ ...editing, draft: { ...editing.draft, status: e.target.value as TaskStatus } })
                  }
                >
                  {COLUMNS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                المسؤول
                <select
                  className="input"
                  value={editing.draft.assignee_id ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, draft: { ...editing.draft, assignee_id: e.target.value || null } })
                  }
                >
                  <option value="">— بدون —</option>
                  {p.members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                الأولوية
                <select
                  className="input"
                  value={editing.draft.priority}
                  onChange={(e) =>
                    setEditing({ ...editing, draft: { ...editing.draft, priority: e.target.value as Priority } })
                  }
                >
                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((k) => (
                    <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                التاريخ
                <input
                  className="input"
                  type="date"
                  value={editing.draft.due_date ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, draft: { ...editing.draft, due_date: e.target.value || null } })
                  }
                />
              </label>
            </div>
            <label className="field">
              ملف مرتبط (اختياري)
              <select
                className="input"
                dir="ltr"
                value={editing.draft.file_path ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, draft: { ...editing.draft, file_path: e.target.value || null } })
                }
              >
                <option value="">—</option>
                {p.paths.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
              <span>
                {editing.id && (
                  <button
                    className="btn danger"
                    onClick={async () => {
                      if (!confirm("حذف التاسك ده؟")) return;
                      await p.onRemove(editing.id!);
                      setEditing(null);
                    }}
                  >
                    حذف
                  </button>
                )}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => setEditing(null)}>إلغاء</button>
                <button className="btn primary" onClick={save}>حفظ</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
