"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { getSupabase } from "@/lib/supabase";
import { SupabaseYProvider } from "@/lib/yjs-supabase-provider";
import { langFor, docTopic } from "@/lib/utils";

type Props = {
  roomId: string;
  path: string;
  me: { name: string; color: string };
  /** called when the LOCAL user edits the doc (drives the "typing" indicator) */
  onTyping?: () => void;
  /** replaces the whole document (history restore); bump nonce to re-apply */
  restore?: { nonce: number; content: string } | null;
};

export default function CollabEditor({ roomId, path, me, onTyping, restore }: Props) {
  const cleanup = useRef<(() => void) | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const typingRef = useRef(onTyping);
  typingRef.current = onTyping;
  const seeding = useRef(false);
  const lastRestore = useRef(restore?.nonce ?? 0);

  useEffect(() => {
    if (!restore || restore.nonce === lastRestore.current) return;
    lastRestore.current = restore.nonce;
    const yt = ytextRef.current;
    if (!yt || !yt.doc) return;
    yt.doc.transact(() => {
      yt.delete(0, yt.length);
      yt.insert(0, restore.content);
    });
  }, [restore]);

  useEffect(() => () => cleanup.current?.(), []);

  const handleMount: OnMount = (editor) => {
    let disposed = false;
    const sb = getSupabase();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { name: me.name, color: me.color });

    const provider = new SupabaseYProvider(sb, docTopic(roomId, path), doc, awareness);
    const ytext = doc.getText("code");
    ytextRef.current = ytext;

    // per-client cursor colours + name labels
    const styleEl = document.createElement("style");
    document.head.appendChild(styleEl);
    const renderStyles = () => {
      let css = "";
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID || !state.user) return;
        const color = String(state.user.color).replace(/[^#a-zA-Z0-9]/g, "");
        const name = String(state.user.name).replace(/[\\"\n\r]/g, "");
        css += `
          .yRemoteSelection-${clientId} { background-color: ${color}; }
          .yRemoteSelectionHead-${clientId} { border-color: ${color}; }
          .yRemoteSelectionHead-${clientId}::after {
            content: "${name}"; position: absolute; top: -1.5em; left: -2px;
            background: ${color}; color: #111; font-size: 11px; line-height: 1.4;
            padding: 0 5px; border-radius: 3px; white-space: nowrap; pointer-events: none;
          }`;
      });
      styleEl.textContent = css;
    };
    awareness.on("change", renderStyles);

    // debounced persistence (only the author of a change saves it)
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      saveTimer = null;
      void sb
        .from("files")
        .update({ content: ytext.toString(), updated_at: new Date().toISOString() })
        .eq("room_id", roomId)
        .eq("path", path);
    };
    const onLocalUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === provider) return;
      if (!seeding.current) typingRef.current?.();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 1000);
    };
    doc.on("update", onLocalUpdate);

    let binding: { destroy(): void } | null = null;

    void (async () => {
      // y-monaco touches `window`, so load it only in the browser
      const { MonacoBinding } = await import("y-monaco");
      if (disposed) return;
      const model = editor.getModel();
      if (!model) return;
      binding = new MonacoBinding(ytext, model, new Set([editor]), awareness);

      await provider.whenSynced;
      if (disposed) return;
      // small jitter so two people opening an empty doc together don't both seed it
      await new Promise((r) => setTimeout(r, Math.random() * 400));
      if (disposed || ytext.length > 0) return;
      const { data } = await sb
        .from("files")
        .select("content")
        .eq("room_id", roomId)
        .eq("path", path)
        .maybeSingle();
      if (!disposed && data?.content && ytext.length === 0) {
        seeding.current = true;
        ytext.insert(0, data.content);
        seeding.current = false;
      }
    })();

    cleanup.current = () => {
      disposed = true;
      if (saveTimer) {
        clearTimeout(saveTimer);
        save();
      }
      binding?.destroy();
      awareness.off("change", renderStyles);
      provider.destroy();
      doc.destroy();
      styleEl.remove();
      ytextRef.current = null;
      cleanup.current = null;
    };
  };

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      path={`${roomId}/${path}`}
      language={langFor(path)}
      defaultValue=""
      onMount={handleMount}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
      }}
    />
  );
}
