import assert from "node:assert/strict";
import test from "node:test";
import { RoomChronicleClient } from "../src/renderer/src/features/room/RoomChronicleClient";
import { RoomChronicleController } from "../../../packages/signaling/src/room-chronicle-controller";
import type { ChronicleStateMessage, SignalEnvelope } from "@private-voice/signaling";

test("three peers automatically join and each distinct microphone is recognized once", async () => {
  const controller = new RoomChronicleController();
  const clients = new Map<string, RoomChronicleClient>();
  const members = ["peer-a", "peer-b", "peer-c"];
  const latest = new Map<string, ChronicleStateMessage>();
  let recognitions = 0;
  controller.configure(
    {
      speechService: {
        isConfigured: () => true,
        transcribe: async () => {
          recognitions++;
          return { text: "合成语音", modelName: "fixture" };
        },
      },
      textService: { isConfigured: () => true, execute: async () => '{"text":"合成纪事"}' },
    },
    () => undefined,
  );
  for (const id of members) {
    const client = new RoomChronicleClient(
      "test-room",
      id,
      async (message) => {
        if (message.type === "chronicle_control") {
          controller.handle("test-room", id, members, message, (target, response) =>
            clients.get(target)?.receive(response),
          );
        } else if (message.type === "chronicle_audio") {
          await controller.audio(message, id, (response) => clients.get(id)?.receive(response));
        }
      },
      (message) => latest.set(id, message),
    );
    clients.set(id, client);
    client.capability(true);
  }
  try {
    await clients.get("peer-a")!.control("start");
    const session = latest.get("peer-a")!.state!.sessionId;
    await clients.get("peer-b")!.joinAutomatically(session);
    await clients.get("peer-c")!.joinAutomatically(session);
    assert.deepEqual(new Set(latest.get("peer-a")!.state!.participants), new Set(members));
    for (const id of members) {
      const part = {
        sessionId: session,
        chunkId: `chunk-${id}`,
        mime: "audio/webm" as const,
        durationMs: 1000,
        startedAt: Date.now(),
        data: "YXVkaW8=",
      };
      await clients.get(id)!.audio(part);
      await clients.get(id)!.audio(part);
    }
    assert.equal(recognitions, 3, "one recognition per distinct source, no duplicate on retry");
    await clients.get("peer-b")!.control("participate", session, false);
    await clients.get("peer-b")!.joinAutomatically(session);
    assert.equal(latest.get("peer-a")!.state!.participants.includes("peer-b"), false);
  } finally {
    for (const client of clients.values()) client.dispose();
    controller.dispose();
  }
});

test("automatically joins with bounded retries and respects a member stopping their own speech across reconnects", async (t) => {
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  const sent: SignalEnvelope[] = [];
  const send = async (message: SignalEnvelope) => {
    sent.push(message);
  };
  const client = new RoomChronicleClient("auto-room", "auto-peer", send);
  client.capability(true);
  await client.joinAutomatically("session-one");
  await client.joinAutomatically("session-one");
  assert.equal(sent.length, 1);
  assert.ok(sent[0]?.type === "chronicle_control" && sent[0].enabled === true);
  now += 10_000;
  await client.joinAutomatically("session-one");
  assert.equal(sent.length, 2, "an unconfirmed join is retried after the cooldown");
  await client.control("participate", "session-one", false);
  const reconnected = new RoomChronicleClient("auto-room", "reconnected-peer", send);
  reconnected.capability(true);
  await reconnected.joinAutomatically("session-one");
  assert.equal(sent.length, 3);
  await reconnected.joinAutomatically("session-two");
  assert.equal(sent.length, 4);
  assert.ok(sent[3]?.type === "chronicle_control" && sent[3].sessionId === "session-two");
});

test("older servers receive no chronicle messages and audio waits for a room-scoped acknowledgement", async () => {
  const sent: unknown[] = [];
  const transport = new RoomChronicleClient("main", "a", async (message) => {
    sent.push(message);
  });
  await assert.rejects(transport.control("start"), /unavailable/);
  assert.deepEqual(sent, []);
  transport.capability(true);
  await transport.control("start");
  const pending = transport.audio({
    sessionId: "s",
    chunkId: "one",
    mime: "audio/webm",
    durationMs: 30000,
    startedAt: Date.now(),
    data: "YXVkaW8=",
  });
  await assert.rejects(
    transport.audio({
      sessionId: "s",
      chunkId: "two",
      mime: "audio/webm",
      durationMs: 30000,
      startedAt: Date.now(),
      data: "YXVkaW8=",
    }),
    /busy/,
  );
  transport.receive({ type: "chronicle_state", roomId: "side", chunkId: "one" });
  assert.equal(sent.length, 2);
  transport.receive({ type: "chronicle_state", roomId: "main", chunkId: "one" });
  await pending;
  const interrupted = transport.audio({
    sessionId: "s",
    chunkId: "two",
    mime: "audio/webm",
    durationMs: 30000,
    startedAt: Date.now(),
    data: "YXVkaW8=",
  });
  transport.dispose();
  await assert.rejects(interrupted, /closed/);
});

test("a control error without a snapshot retains the session for bounded automatic retry", () => {
  const updates: ChronicleStateMessage[] = [];
  const client = new RoomChronicleClient(
    "room",
    "peer",
    async () => {},
    (message) => updates.push(message),
  );
  client.capability(true);
  client.receive({
    type: "chronicle_state",
    roomId: "room",
    state: { sessionId: "s", participants: [], entries: [] },
  });
  client.receive({ type: "chronicle_state", roomId: "room", error: "chronicle_forbidden" });
  assert.equal(updates.at(-1)?.state?.sessionId, "s");
  client.receive({ type: "chronicle_state", roomId: "room" });
  assert.equal(updates.at(-1)?.state, undefined, "a stopped session must not be restored");
  client.dispose();
});

test("capability loss releases pending upload immediately, ignores late acknowledgements, and allows a new supported connection", async () => {
  const updates: ChronicleStateMessage[] = [];
  const transport = new RoomChronicleClient(
    "main",
    "a",
    async () => {},
    (message) => updates.push(message),
  );
  const part = {
    sessionId: "s",
    chunkId: "one",
    mime: "audio/webm" as const,
    durationMs: 30000,
    startedAt: Date.now(),
    data: "YXVkaW8=",
  };
  transport.receive({ type: "chronicle_state", roomId: "main" });
  assert.equal(updates.length, 0, "unadvertised capability must not accept state");
  transport.capability(true);
  const pending = transport.audio(part);
  const rejected = assert.rejects(pending, /chronicle_unavailable/);
  transport.capability(false);
  await rejected;
  const count = updates.length;
  transport.receive({ type: "chronicle_state", roomId: "main", chunkId: "one" });
  assert.equal(updates.length, count, "late ACK must not restore unavailable state");
  transport.capability(true);
  const recovered = transport.audio({ ...part, chunkId: "two" });
  transport.receive({ type: "chronicle_state", roomId: "main", chunkId: "two" });
  await recovered;
  transport.dispose();
  const disposedCount = updates.length;
  transport.capability(true);
  transport.receive({ type: "chronicle_state", roomId: "main" });
  assert.equal(updates.length, disposedCount, "disposed room client cannot be revived");
  await assert.rejects(transport.control("start"), /unavailable/);
});

test("synchronous send failure releases the upload slot for retry", async () => {
  let attempts = 0;
  const transport = new RoomChronicleClient("main", "a", () => {
    if (++attempts === 1) throw Error("transport_closed");
    return Promise.resolve();
  });
  const part = {
    sessionId: "s",
    chunkId: "one",
    mime: "audio/webm" as const,
    durationMs: 30000,
    startedAt: Date.now(),
    data: "YXVkaW8=",
  };
  transport.capability(true);
  await assert.rejects(transport.audio(part), /transport_closed/);
  const retry = transport.audio({ ...part, chunkId: "two" });
  transport.receive({ type: "chronicle_state", roomId: "main", chunkId: "two" });
  await retry;
  assert.equal(attempts, 2);
  transport.dispose();
});
