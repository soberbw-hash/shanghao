import assert from "node:assert/strict";
import test from "node:test";
import {
  retainRoomRuntime,
  restoreRoomClientRef,
  type RoomRuntimeHotState,
} from "../src/renderer/src/features/room/roomRuntimeHotState";
import { RoomSessionOwnership } from "../src/renderer/src/features/room/sessionOwnership";
import { publishRoomScreenShare } from "../src/renderer/src/features/screen-share/publishRoomScreenShare";
import { screenShareErrorMessage } from "../src/renderer/src/features/screen-share/screenShareErrorMessage";

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

test("a join finishing after a hot update remains visible to the new room module", () => {
  const oldRef = restoreRoomClientRef();
  const previous = { activeClient: null, activeClientRef: oldRef } as RoomRuntimeHotState;
  const newRef = restoreRoomClientRef(previous);
  const connected = { canSendChat: () => true } as RoomRuntimeHotState["activeClient"];
  oldRef.current = connected;
  assert.equal(newRef.current, connected);
  newRef.current = null;
  assert.equal(oldRef.current, null);
});

test("screen sharing uses the live client after hot reload and stops capture if the room is gone", async () => {
  const oldRef = restoreRoomClientRef();
  const newRef = restoreRoomClientRef({
    activeClient: null,
    activeClientRef: oldRef,
  } as RoomRuntimeHotState);
  let published = 0;
  let stopped = 0;
  const stream = {
    getTracks: () => [
      {
        stop: () => {
          stopped++;
        },
      },
    ],
  } as unknown as MediaStream;
  oldRef.current = {
    startScreenShare: async () => {
      published++;
    },
  } as unknown as RoomRuntimeHotState["activeClient"];
  await publishRoomScreenShare(newRef, stream);
  assert.equal(published, 1);
  assert.equal(stopped, 0);
  oldRef.current = null;
  await assert.rejects(publishRoomScreenShare(newRef, stream), /room_not_connected/);
  assert.equal(stopped, 1);
  assert.match(screenShareErrorMessage(Error("room_not_connected")), /房间连接未就绪/);
  assert.match(
    screenShareErrorMessage(new DOMException("capture failed", "NotReadableError")),
    /Windows 无法读取/,
  );
});
