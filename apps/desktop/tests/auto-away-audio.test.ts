import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_AWAY_IDLE_SECONDS,
  IDLE_POLL_INTERVAL_MS,
  decideAutoAway,
  shouldMuteAfterAwayReturn,
} from "../src/renderer/src/features/room/autoAway";

test("OS idle polling has a strict 30 minute boundary", () => {
  assert.equal(IDLE_POLL_INTERVAL_MS, 10_000);
  assert.equal(AUTO_AWAY_IDLE_SECONDS, 1_800);
  assert.equal(decideAutoAway({ idleSeconds: 1_799, isInAwayZone: false }), "none");
  assert.equal(decideAutoAway({ idleSeconds: 1_800, isInAwayZone: false }), "auto_away");
  assert.equal(
    decideAutoAway({
      idleSeconds: 3_600,
      isInAwayZone: false,
      isProtectedActivity: true,
    }),
    "none",
  );
});

test("only automatically-away members return on OS activity", () => {
  assert.equal(
    decideAutoAway({ idleSeconds: 0, isInAwayZone: true, awayMethod: "auto" }),
    "auto_return",
  );
  assert.equal(
    decideAutoAway({ idleSeconds: 0, isInAwayZone: true, awayMethod: "manual" }),
    "none",
  );
  assert.equal(
    decideAutoAway({ idleSeconds: 1_900, isInAwayZone: true, awayMethod: "auto" }),
    "none",
  );
});

test("returning from away never unmutes a player who was already muted", () => {
  assert.equal(shouldMuteAfterAwayReturn({ wasMuted: true, isDeafened: false }), true);
  assert.equal(shouldMuteAfterAwayReturn({ wasMuted: false, isDeafened: true }), true);
  assert.equal(shouldMuteAfterAwayReturn({ wasMuted: false, isDeafened: false }), false);
});

test("deafen and microphone state changes are atomic", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        app: { writeLog: async () => undefined },
      },
    },
  });
  const { useAudioStore } = await import("../src/renderer/src/store/audioStore");
  useAudioStore.getState().setAudioState({ isMuted: false, isDeafened: false });
  useAudioStore.getState().deafenAndMute();
  assert.deepEqual(
    {
      isMuted: useAudioStore.getState().isMuted,
      isDeafened: useAudioStore.getState().isDeafened,
    },
    { isMuted: true, isDeafened: true },
  );

  useAudioStore.getState().toggleMicrophone();
  assert.equal(useAudioStore.getState().isMuted, true);

  useAudioStore.getState().undeafenAndUnmute();
  assert.deepEqual(
    {
      isMuted: useAudioStore.getState().isMuted,
      isDeafened: useAudioStore.getState().isDeafened,
    },
    { isMuted: false, isDeafened: false },
  );
});
