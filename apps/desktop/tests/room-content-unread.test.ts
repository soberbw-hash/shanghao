import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "@private-voice/shared";
import { RoomContentReadCursor } from "../src/renderer/src/features/chat/roomContentUnread";

const at = Date.now();
const message = (id: string, time = at + 100, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  peerId: "friend",
  nickname: "朋友",
  content: "隔离测试",
  createdAt: new Date(time).toISOString(),
  ...extra,
});
test("inactive chat alerts only for new incoming messages; reading clears without reconnect duplicates", () => {
  const cursor = new RoomContentReadCursor();
  const old = message("old", at - 1000);
  assert.deepEqual(cursor.observe("room-a", [old], undefined, "chat", at), {
    chat: false,
    chronicle: false,
  });
  const fresh = message("fresh");
  assert.equal(cursor.observe("room-a", [old, fresh], undefined, "chronicle").chat, true);
  assert.equal(cursor.read("chat").chat, false);
  assert.equal(cursor.observe("room-a", [old, fresh], undefined, "chat").chat, false);
  assert.equal(cursor.observe("room-a", [old, fresh], undefined, "chronicle").chat, false);
  assert.equal(
    cursor.observe("room-a", [message("backfill", at - 5000), old, fresh], undefined, "chronicle")
      .chat,
    false,
  );
});
test("optimistic sends, ACK replacements and system messages do not create remote unread alerts", () => {
  const cursor = new RoomContentReadCursor();
  cursor.observe("a", [], undefined, "chat", at);
  cursor.observe(
    "a",
    [message("local", at + 100, { isLocal: true, clientMessageId: "client" })],
    undefined,
    "chronicle",
  );
  assert.equal(
    cursor.observe(
      "a",
      [message("server", at + 100, { isLocal: true, clientMessageId: "client" })],
      undefined,
      "chronicle",
    ).chat,
    false,
  );
  assert.equal(
    cursor.observe("a", [message("system", at + 200, { kind: "system" })], undefined, "chronicle")
      .chat,
    false,
  );
});
test("chronicle start and new entries alert, participant/status updates do not; room changes reset both cursors", () => {
  const cursor = new RoomContentReadCursor();
  cursor.observe("a", [], undefined, "chat", at);
  const state = { sessionId: "session", entries: [] as { id: string }[] };
  assert.equal(cursor.observe("a", [], state, "chat").chronicle, true);
  cursor.read("chronicle");
  assert.equal(cursor.observe("a", [], { ...state }, "chat").chronicle, false);
  const next = { ...state, entries: [{ id: "entry" }] };
  assert.equal(cursor.observe("a", [], next, "chat").chronicle, true);
  assert.equal(cursor.observe("a", [], next, "chronicle").chronicle, false);
  assert.equal(cursor.observe("a", [], next, "chat").chronicle, false);
  assert.deepEqual(cursor.observe("b", [message("history")], next, "chat"), {
    chat: false,
    chronicle: false,
  });
});
test("visible content is read immediately and an ACK without state does not reset chronicle dedupe", () => {
  const cursor = new RoomContentReadCursor();
  const state = { sessionId: "s", entries: [{ id: "e" }] };
  cursor.observe("a", [], undefined, "chronicle", at);
  assert.equal(cursor.observe("a", [], state, "chronicle").chronicle, false);
  cursor.observe("a", [], undefined, "chat");
  assert.equal(cursor.observe("a", [], state, "chat").chronicle, false);
});

test("an optimistic local clock ahead of the server cannot suppress the next incoming alert", () => {
  const cursor = new RoomContentReadCursor();
  cursor.observe("a", [], undefined, "chat", at);
  const local = message("local-future", at + 60000, { isLocal: true });
  cursor.observe("a", [local], undefined, "chronicle");
  assert.equal(
    cursor.observe("a", [local, message("incoming", at + 100)], undefined, "chronicle").chat,
    true,
  );
});
