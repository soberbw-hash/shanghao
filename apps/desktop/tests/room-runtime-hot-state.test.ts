import assert from "node:assert/strict";
import test from "node:test";
import {
  retainRoomRuntime,
  type RoomRuntimeHotState,
} from "../src/renderer/src/features/room/roomRuntimeHotState";
import { RoomSessionOwnership } from "../src/renderer/src/features/room/sessionOwnership";

test("hot updates retain the live runtime at disposal without closing resources", () => {
  let dispose: ((data: Record<string, unknown>) => void) | undefined;
  const hot = {
    dispose: (callback: typeof dispose) => {
      dispose = callback;
    },
  } as Parameters<typeof retainRoomRuntime>[0];
  const queue = Promise.resolve();
  const state: RoomRuntimeHotState = {
    activeClient: null,
    activeJoinPromise: null,
    activeSpeakingDetector: null,
    activeProcessedMicrophone: null,
    inputDeviceSwitchQueue: queue,
    roomSessionOwnership: new RoomSessionOwnership(),
    lastQuickMessageSentAt: 0,
    lastQuickMessageCooldownMs: 3000,
  };
  retainRoomRuntime(hot, () => state);
  state.activePeerId = "live-peer";
  const data: Record<string, unknown> = {};
  dispose?.(data);
  assert.equal(data.roomRuntime, state);
  assert.equal((data.roomRuntime as RoomRuntimeHotState).activePeerId, "live-peer");
  assert.equal((data.roomRuntime as RoomRuntimeHotState).inputDeviceSwitchQueue, queue);
  assert.doesNotThrow(() => retainRoomRuntime(undefined, () => state));
});
