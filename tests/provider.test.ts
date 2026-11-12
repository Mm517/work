import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseYProvider } from "@/lib/yjs-supabase-provider";

/** In-memory stand-in for supabase-js Realtime broadcast (self:false semantics). */
class FakeBus {
  channels: FakeChannel[] = [];
  configs: { topic: string; config: any }[] = [];
}
type Handler = (m: { payload: any }) => void;
class FakeChannel {
  handlers: Handler[] = [];
  constructor(private bus: FakeBus, public topic: string) {}
  on(_type: string, _filter: unknown, cb: Handler) {
    this.handlers.push(cb);
    return this;
  }
  subscribe(cb: (s: string) => void) {
    this.bus.channels.push(this);
    queueMicrotask(() => cb("SUBSCRIBED"));
    return this;
  }
  send({ payload }: { payload: unknown }) {
    for (const ch of this.bus.channels) {
      if (ch === this || ch.topic !== this.topic) continue;
      queueMicrotask(() => ch.handlers.forEach((h) => h({ payload: JSON.parse(JSON.stringify(payload)) })));
    }
    return Promise.resolve("ok");
  }
}
const fakeClient = (bus: FakeBus) =>
  ({
    channel(topic: string, config: unknown) {
      bus.configs.push({ topic, config });
      return new FakeChannel(bus, topic);
    },
    removeChannel(ch: FakeChannel) {
      bus.channels = bus.channels.filter((c) => c !== ch);
      return Promise.resolve("ok");
    },
  }) as unknown as SupabaseClient;

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function peer(bus: FakeBus, topic = "room:r1:doc:a.ts") {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const provider = new SupabaseYProvider(fakeClient(bus), topic, doc, awareness);
  return { doc, awareness, provider, text: doc.getText("code") };
}

describe("SupabaseYProvider", () => {
  it("opens PRIVATE channels (required by the realtime.messages RLS policies)", async () => {
    const bus = new FakeBus();
    const a = peer(bus);
    await tick();
    expect(bus.configs[0].config.config.private).toBe(true);
    a.provider.destroy();
  });

  it("propagates edits both ways", async () => {
    const bus = new FakeBus();
    const a = peer(bus);
    const b = peer(bus);
    await tick();
    a.text.insert(0, "hello");
    await tick();
    expect(b.text.toString()).toBe("hello");
    b.text.insert(5, " world");
    await tick();
    expect(a.text.toString()).toBe("hello world");
  });

  it("converges after concurrent edits", async () => {
    const bus = new FakeBus();
    const a = peer(bus);
    const b = peer(bus);
    await tick();
    a.text.insert(0, "AAA");
    b.text.insert(0, "BBB");
    await tick();
    expect(a.text.toString()).toBe(b.text.toString());
    expect(a.text.toString().length).toBe(6);
  });

  it("late joiner receives the existing state (sync handshake)", async () => {
    const bus = new FakeBus();
    const a = peer(bus);
    await tick();
    a.text.insert(0, "existing content");
    await tick();
    const late = peer(bus);
    expect(await late.provider.whenSynced).toBe(true);
    expect(late.text.toString()).toBe("existing content");
  });

  it("whenSynced resolves false when nobody else is there", async () => {
    const bus = new FakeBus();
    const a = peer(bus);
    expect(await a.provider.whenSynced).toBe(false);
  });

  it("shares awareness (cursor/name) and clears it on destroy", async () => {
    const bus = new FakeBus();
    const a = peer(bus);
    const b = peer(bus);
    await tick();
    a.awareness.setLocalStateField("user", { name: "Ahmed", color: "#fff" });
    await tick();
    expect(b.awareness.getStates().get(a.doc.clientID)?.user?.name).toBe("Ahmed");
    a.provider.destroy();
    await tick();
    expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false);
  });

  it("does not leak between different topics (different files/rooms)", async () => {
    const bus = new FakeBus();
    const a = peer(bus, "room:r1:doc:a.ts");
    const other = peer(bus, "room:r2:doc:a.ts");
    await tick();
    a.text.insert(0, "secret");
    await tick();
    expect(other.text.toString()).toBe("");
  });

  it("stops syncing and removes its channel after destroy()", async () => {
    const bus = new FakeBus();
    const a = peer(bus);
    const b = peer(bus);
    await tick();
    b.provider.destroy();
    expect(bus.channels.length).toBe(1);
    a.text.insert(0, "after");
    await tick();
    expect(b.text.toString()).toBe("");
  });
});
