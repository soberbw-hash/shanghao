import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDefaultMemberVolumes,
  cancelPendingMemberVolumeSaves,
  configureMemberVolumePersistence,
  registerMemberVolumeReset,
  resetRuntimeMemberVolumes,
  runtimeMemberVolumes,
  scheduleMemberVolumeSave,
} from "../src/renderer/src/features/room/memberVolumePersistence";

test("member volume reset cancels pending writes and clears the live mapping", async () => {
  const applied: string[] = [];
  applyDefaultMemberVolumes(
    [
      { id: "self", isLocal: true },
      { id: "friend", isLocal: false },
      { id: "empty", isLocal: false, isEmptySlot: true },
    ],
    (peerId, volume) => applied.push(`${peerId}:${volume}`),
  );
  assert.deepEqual(applied, ["friend:1"]);

  const globalWindow = globalThis as unknown as { window?: Window };
  const previousWindow = globalWindow.window;
  let timer: (() => void) | undefined;
  let cancelledTimer = false;
  const saved: Array<Record<string, number>> = [];
  let runtimeResetCount = 0;
  globalWindow.window = {
    setTimeout: (callback: () => void) => {
      timer = callback;
      return 7;
    },
    clearTimeout: (id: number) => {
      cancelledTimer = id === 7;
      timer = undefined;
    },
  } as unknown as Window;
  try {
    configureMemberVolumePersistence({
      getMemberVolumes: () => ({ friend: 0.4 }),
      saveMemberVolumes: async (volumes) => {
        saved.push(volumes);
      },
    });
    registerMemberVolumeReset(() => {
      runtimeResetCount += 1;
    });
    runtimeMemberVolumes.set("friend", 0.4);
    scheduleMemberVolumeSave("friend", 0.4);

    cancelPendingMemberVolumeSaves();
    resetRuntimeMemberVolumes();

    assert.equal(cancelledTimer, true);
    assert.equal(timer, undefined);
    assert.equal(runtimeMemberVolumes.size, 0);
    assert.equal(runtimeResetCount, 1);
    assert.deepEqual(saved, []);

    scheduleMemberVolumeSave("friend", 1);
    timer?.();
    await Promise.resolve();
    assert.deepEqual(saved, [{ friend: 1 }]);
  } finally {
    cancelPendingMemberVolumeSaves();
    globalWindow.window = previousWindow;
  }
});
