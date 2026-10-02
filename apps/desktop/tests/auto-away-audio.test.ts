import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RoomConnectionState } from "@private-voice/shared";

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
      isConnectionValid: false,
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

test("away return preserves the captured microphone choice and respects deafen", () => {
  assert.equal(shouldMuteAfterAwayReturn({ isDeafened: false, wasMuted: false }), false);
  assert.equal(shouldMuteAfterAwayReturn({ isDeafened: false, wasMuted: true }), true);
  assert.equal(shouldMuteAfterAwayReturn({ isDeafened: true, wasMuted: false }), true);
  assert.equal(shouldMuteAfterAwayReturn({ isDeafened: true, wasMuted: true }), true);
  assert.equal(shouldMuteAfterAwayReturn({ isDeafened: false }), true);
});

test("actual room idle callbacks restore muted and open microphones over repeated away cycles", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { desktopApi: { app: { writeLog: async () => undefined } } },
  });
  const { useAudioStore } = await import("../src/renderer/src/store/audioStore");
  const source = readFileSync("src/renderer/src/pages/RoomPage.tsx", "utf8");
  const begin = source.indexOf("const checkIdleState = async () => {");
  const finish = source.indexOf("    void checkIdleState();", begin);
  // Execute the production callback, rather than copying its transition rules into this test.
  const build = new Function(
    "window",
    "useRoomStore",
    "useAudioStore",
    "isSeatZone",
    "lastSeatZoneRef",
    "awaySessionRef",
    "setMuted",
    "moveLocalMemberRef",
    "pushToast",
    "decideAutoAway",
    "shouldMuteAfterAwayReturn",
    "RoomConnectionState",
    `let disposed = false; ${source.slice(begin, finish)} return checkIdleState;`,
  );
  let idleSeconds = 0;
  let fail = false;
  const member = { isLocal: true, sceneZone: "gameDesk2", activity: "idle" };
  const room = { connectionState: RoomConnectionState.Connected, members: [member] };
  const away = { current: undefined as { method: string; wasMuted: boolean } | undefined };
  const pageWindow = {
    desktopApi: {
      app: {
        getSystemIdleSeconds: async () => {
          if (fail) throw new Error("idle unavailable");
          return idleSeconds;
        },
        writeLog: async () => undefined,
      },
    },
  };
  const check = build(
    pageWindow,
    { getState: () => ({ room }) },
    useAudioStore,
    (zone: string) => zone.startsWith("gameDesk"),
    { current: "gameDesk2" },
    away,
    (muted: boolean) => useAudioStore.getState().setMuted(muted),
    {
      current: (zone: string) => {
        member.sceneZone = zone;
      },
    },
    () => undefined,
    decideAutoAway,
    shouldMuteAfterAwayReturn,
    RoomConnectionState,
  ) as () => Promise<void>;
  try {
    for (const wasMuted of [true, false, true, false]) {
      useAudioStore.getState().setAudioState({ isMuted: wasMuted, isDeafened: false });
      idleSeconds = 1_800;
      await check();
      assert.equal(member.sceneZone, "restroomZone");
      assert.equal(away.current?.wasMuted, wasMuted);
      assert.equal(useAudioStore.getState().isMuted, true);
      await check();
      assert.equal(away.current?.wasMuted, wasMuted);
      fail = true;
      idleSeconds = 0;
      await check();
      fail = false;
      assert.equal(
        member.sceneZone,
        "restroomZone",
        "failed poll must not treat inactivity as a mouse return",
      );
      await check();
      assert.equal(member.sceneZone, "gameDesk2");
      assert.equal(useAudioStore.getState().isMuted, wasMuted);
      assert.equal(away.current, undefined);
    }
    const handlerSource = source.slice(
      source.indexOf("const handleZoneSelect ="),
      source.indexOf("const handleToggleMicrophone ="),
    );
    const handlerBody = handlerSource.slice(
      handlerSource.indexOf("=> {") + 4,
      handlerSource.lastIndexOf("};"),
    );
    const buildManual = new Function(
      "zone",
      "activity",
      "window",
      "useAudioStore",
      "isSeatZone",
      "lastSeatZoneRef",
      "awaySessionRef",
      "localMember",
      "setMuted",
      "shouldMuteAfterAwayReturn",
      "moveLocalMember",
      "detectedGameRef",
      "detectedMusicRef",
      "detectedGameIconRef",
      handlerBody,
    );
    const select = (zone: string) =>
      buildManual(
        zone,
        "idle",
        pageWindow,
        useAudioStore,
        (target: string) => target.startsWith("gameDesk"),
        { current: "gameDesk2" },
        away,
        member,
        (muted: boolean) => useAudioStore.getState().setMuted(muted),
        shouldMuteAfterAwayReturn,
        (target: string) => {
          member.sceneZone = target;
        },
        {},
        {},
        {},
      );
    for (const wasMuted of [true, false]) {
      useAudioStore.getState().setAudioState({ isMuted: wasMuted, isDeafened: false });
      select("restroomZone");
      select("restroomZone");
      assert.equal(
        away.current?.wasMuted,
        wasMuted,
        "reselecting away cannot overwrite the saved microphone choice",
      );
      select("gameDesk3");
      assert.equal(useAudioStore.getState().isMuted, wasMuted);
      assert.equal(away.current, undefined);
    }
    useAudioStore.getState().setAudioState({ isMuted: false, isDeafened: false });
    member.sceneZone = "gameDesk2";
    idleSeconds = 1_800;
    await check();
    useAudioStore.getState().setDeafened(true);
    idleSeconds = 0;
    await check();
    assert.equal(useAudioStore.getState().isMuted, true);
    assert.equal(useAudioStore.getState().isDeafened, true);
    useAudioStore.getState().setAudioState({ isMuted: false, isDeafened: false });
    idleSeconds = 1_800;
    await check();
    useAudioStore.getState().setPhoneMode(true);
    idleSeconds = 0;
    await check();
    assert.equal(useAudioStore.getState().isMuted, true);
    useAudioStore.getState().setPhoneMode(false);
  } finally {
    useAudioStore.getState().setAudioState({ isMuted: false, isDeafened: false });
  }
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
