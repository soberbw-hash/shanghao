import assert from "node:assert/strict";
import test from "node:test";
import { useRoomStore } from "../src/renderer/src/store/roomStore";

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
