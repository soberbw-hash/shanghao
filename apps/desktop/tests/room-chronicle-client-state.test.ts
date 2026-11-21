import assert from "node:assert/strict";
import test from "node:test";
import { useRoomStore } from "../src/renderer/src/store/roomStore";
import {
  RoomChronicleClient,
  type RoomChronicleViewState,
} from "../src/renderer/src/features/room/RoomChronicleClient";

test("chronicle state ignores other rooms and clears with channel content", () => {
  const store = useRoomStore;
  store.getState().resetRoom();
  store.getState().setRoom({ roomId: "synthetic-a" });
  const state = {
    type: "chronicle_state" as const,
    roomId: "synthetic-a",
    state: { sessionId: "synthetic", participants: [], entries: [] },
  };
  store.getState().setChronicle(state);
  assert.equal(store.getState().chronicle?.state?.sessionId, "synthetic");
  store.getState().setChronicle({ ...state, roomId: "synthetic-b" });
  assert.equal(store.getState().chronicle?.roomId, "synthetic-a");
  store.getState().clearChannelContent();
  assert.equal(store.getState().chronicle, undefined);
  store.getState().setChronicle(state);
  store.getState().resetRoom();
  assert.equal(store.getState().chronicle, undefined);
});

test("reading a room day does not require participation; midnight preserves active capture state", () => {
  let view: RoomChronicleViewState | undefined;
  const sent: unknown[] = [];
  const room = new RoomChronicleClient(
    "main",
    "viewer",
    async (message) => {
      sent.push(message);
    },
    (next) => {
      view = next;
    },
  );
  const today = "2026-11-20";
  const nextDay = "2026-11-21";
  const entry = { id: "story", at: Date.parse(`${today}T23:59:59+08:00`), text: "合成纪事" };
  const packet = {
    type: "chronicle_history" as const,
    roomId: "main",
    date: today,
    entries: [entry],
  };
  room.capability(true, today);
  room.receiveHistory({ ...packet, roomId: "side" });
  assert.deepEqual(view?.day?.entries, []);
  room.receiveHistory({ ...packet, replace: true });
  room.receiveHistory(packet);
  assert.deepEqual(view?.day?.entries, [entry]);
  assert.equal(view?.state, undefined);
  assert.deepEqual(sent, []);

  room.receive({
    type: "chronicle_state",
    roomId: "main",
    state: { sessionId: "live", participants: ["speaker"], entries: [entry] },
  });
  room.receiveHistory({ ...packet, date: nextDay, replace: true, entries: [] });
  room.receiveHistory(packet);
  assert.equal(view?.day?.date, nextDay);
  assert.deepEqual(view?.day?.entries, []);
  assert.equal(view?.state?.sessionId, "live");
  assert.deepEqual(view?.state?.participants, ["speaker"]);
});
