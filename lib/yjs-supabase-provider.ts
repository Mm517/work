import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as bin from "lib0/buffer";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Kind = "update" | "sync-req" | "sync-res" | "aw" | "aw-query";
type Msg = { k: Kind; d?: string };

/**
 * Minimal Yjs provider that syncs a Y.Doc + Awareness over a Supabase
 * Realtime broadcast channel. No custom server needed.
 */
export class SupabaseYProvider {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  /** Resolves true if a peer answered the sync request, false on timeout. */
  readonly whenSynced: Promise<boolean>;

  private sb: SupabaseClient;
  private channel: RealtimeChannel;
  private settle!: (hadPeers: boolean) => void;
  private settled = false;
  private ready = false;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    sb: SupabaseClient,
    topic: string,
    doc: Y.Doc,
    awareness: awarenessProtocol.Awareness
  ) {
    this.sb = sb;
    this.doc = doc;
    this.awareness = awareness;
    this.whenSynced = new Promise<boolean>((resolve) => {
      this.settle = (v) => {
        if (this.settled) return;
        this.settled = true;
        resolve(v);
      };
    });

    // private: only room members pass the realtime.messages RLS policies
    this.channel = sb.channel(topic, { config: { private: true, broadcast: { self: false } } });
    this.channel.on("broadcast", { event: "y" }, ({ payload }) =>
      this.onMessage(payload as Msg)
    );

    doc.on("update", this.onDocUpdate);
    awareness.on("update", this.onAwarenessUpdate);

    this.channel.subscribe((status) => {
      if (status === "SUBSCRIBED") this.onSubscribed();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") this.settle(false);
    });
  }

  private send(k: Kind, data?: Uint8Array) {
    if (this.destroyed || !this.ready) return;
    const payload: Msg = { k, d: data ? bin.toBase64(data) : undefined };
    void this.channel.send({ type: "broadcast", event: "y", payload });
  }

  private onSubscribed() {
    this.ready = true;
    this.send("sync-req", Y.encodeStateVector(this.doc));
    this.send("aw-query");
    this.send(
      "aw",
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
    );
    // push anything typed before the channel was ready
    if (this.doc.store.clients.size > 0) {
      this.send("update", Y.encodeStateAsUpdate(this.doc));
    }
    this.timer = setTimeout(() => this.settle(false), 700);
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.send("update", update);
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return;
    const changed = added.concat(updated, removed);
    this.send("aw", awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
  };

  private onMessage(msg: Msg) {
    if (this.destroyed) return;
    const data = msg.d ? bin.fromBase64(msg.d) : undefined;
    switch (msg.k) {
      case "update":
        if (data) Y.applyUpdate(this.doc, data, this);
        break;
      case "sync-req":
        if (data) this.send("sync-res", Y.encodeStateAsUpdate(this.doc, data));
        break;
      case "sync-res":
        if (data) Y.applyUpdate(this.doc, data, this);
        if (this.timer) clearTimeout(this.timer);
        this.settle(true);
        break;
      case "aw":
        if (data) awarenessProtocol.applyAwarenessUpdate(this.awareness, data, this);
        break;
      case "aw-query":
        this.send(
          "aw",
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
        );
        break;
    }
  }

  destroy() {
    if (this.destroyed) return;
    // tell peers we left (still sendable because destroyed is false here)
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.settle(false);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    void this.sb.removeChannel(this.channel);
  }
}
