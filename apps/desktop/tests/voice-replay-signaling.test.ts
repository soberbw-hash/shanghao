import assert from "node:assert/strict";
import test from "node:test";
import { RoomReplayController } from "../../../packages/signaling/src/room-replay-controller";
import { RoomReplayConsent } from "../../../packages/signaling/src/room-replay-consent";
import {
  isSignalEnvelope,
  type ReplayStateMessage,
} from "../../../packages/signaling/src/protocol";
import { RoomReplayClient } from "../src/renderer/src/features/room/RoomReplayClient";
import { useRoomStore } from "../src/renderer/src/store/roomStore";

test("replay requires exact-generation approval from all current members; membership resets all approvals", () => {
  const rooms = new RoomReplayConsent();
  rooms.start("a", "one", ["one", "two"]);
  const first = rooms.snapshot("a")!;
  assert.equal(first.enabled, false);
  assert.throws(() => rooms.vote("a", "stranger", first.sessionId, first.epoch, true));
  rooms.vote("a", "two", first.sessionId, first.epoch, true);
  assert.equal(rooms.snapshot("a")!.enabled, true);
  first.members.push("cannot-mutate-store");
  assert.equal(rooms.snapshot("a")!.members.length, 2);
  rooms.sync("a", ["one", "two", "new"]);
  const next = rooms.snapshot("a")!;
  assert.equal(next.epoch, first.epoch + 1);
  assert.equal(next.enabled, false);
  assert.deepEqual(next.approved, []);
  assert.throws(() => rooms.vote("a", "two", first.sessionId, first.epoch, true));
  for (const id of next.members) rooms.vote("a", id, next.sessionId, next.epoch, true);
  assert.equal(rooms.snapshot("a")!.enabled, true);
  rooms.vote("a", "one", next.sessionId, next.epoch, false);
  assert.equal(rooms.snapshot("a")!.enabled, false);
  rooms.start("other", "one", ["one"]);
  assert.equal(rooms.snapshot("other")!.enabled, true);
  assert.equal(rooms.snapshot("a")!.enabled, false);
  rooms.sync("a", []);
  assert.equal(rooms.snapshot("a"), undefined);
  rooms.start("a", "one", ["one"]);
  assert.notEqual(rooms.snapshot("a")!.sessionId, next.sessionId);
});

test("controller binds approvals to authenticated identities; protocol rejects stale shapes", () => {
  const controller = new RoomReplayController();
  const sent: ReplayStateMessage[] = [];
  const send = (_target: string, response: ReplayStateMessage) => sent.push(response);
  controller.handle(
    "main",
    "one",
    ["one", "two"],
    { type: "replay_control", roomId: "main", peerId: "two", action: "start" },
    send,
  );
  const state = sent[0]!.state!;
  assert.deepEqual(state.approved, ["one"]);
  controller.handle(
    "main",
    "one",
    ["one", "two"],
    { type: "replay_control", roomId: "main", peerId: "two", action: "approve", ...state },
    send,
  );
  assert.equal(sent.at(-1)?.state?.enabled, false);
  controller.handle(
    "side",
    "two",
    ["two"],
    { type: "replay_control", roomId: "side", peerId: "two", action: "read" },
    send,
  );
  assert.equal(sent.at(-1)?.state, undefined);
  assert.equal(
    isSignalEnvelope({
      type: "replay_control",
      roomId: "main",
      peerId: "one",
      action: "approve",
      sessionId: state.sessionId,
      epoch: NaN,
    }),
    false,
  );
  assert.equal(isSignalEnvelope({ type: "replay_state", roomId: "main", state }), false);
});

test("old servers receive no replay controls; room store clears consent on room changes", async () => {
  const sent: unknown[] = [],
    changed: ReplayStateMessage[] = [];
  const client = new RoomReplayClient(
    "one",
    "me",
    async (message) => {
      sent.push(message);
    },
    (message) => changed.push(message),
  );
  await assert.rejects(client.control("start"), /unavailable/);
  assert.deepEqual(sent, []);
  client.capability(true);
  await client.control("start");
  client.receive({ type: "replay_state", roomId: "other" });
  assert.equal(changed.length, 1);
  const store = useRoomStore;
  store.getState().resetRoom();
  store.getState().setRoom({ roomId: "one" });
  store.getState().setReplay({ type: "replay_state", roomId: "one", available: true });
  store.getState().setReplay({ type: "replay_state", roomId: "other", available: false });
  assert.equal(store.getState().replay?.available, true);
  store.getState().clearChannelContent();
  assert.equal(store.getState().replay, undefined);
  client.dispose();
  await assert.rejects(client.control("start"), /unavailable/);
  const disposedCount = changed.length;
  client.capability(true);
  client.receive({ type: "replay_state", roomId: "one", available: true });
  client.dispose();
  assert.equal(
    changed.length,
    disposedCount,
    "late capability or state cannot revive disposed consent",
  );
  await assert.rejects(client.control("approve", { sessionId: "stale", epoch: 1 }), /unavailable/);
});
