import assert from "node:assert/strict";
import test from "node:test";
import { RoomChronicleClient } from "../src/renderer/src/features/room/RoomChronicleClient";
import type { ChronicleStateMessage } from "@private-voice/signaling";

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
