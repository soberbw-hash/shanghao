import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { RoomLifecycleState } from "@private-voice/shared";
import * as reminder from "../src/renderer/src/features/audio/mutedSpeechReminder";

function fixture(focused = false) {
  const makeStore = <T extends object>(initial: T) => {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      getState: () => value,
      listeners,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      patch(patch: Partial<T>) {
        value = { ...value, ...patch };
        for (const listener of listeners) listener();
      },
    };
  };
  const audio = makeStore({
    isMuted: true,
    isManuallyMuted: true,
    isDeafened: false,
    phoneModeActive: false,
    isPushToTalkEnabled: false,
    localDiagnostics: undefined as object | undefined,
  });
  const track = { id: "synthetic-track", readyState: "live", enabled: false, muted: false };
  const room = makeStore({
    room: { roomId: "room-a", lifecycleState: RoomLifecycleState.Open },
    localStream: { getAudioTracks: () => [track] },
  });
  const settings = makeStore({
    settings: {
      isMutedSpeechReminderEnabled: true,
      isPushToTalkEnabled: false,
      isUiSoundEnabled: true,
      isSystemNotificationEnabled: true,
    },
  });
  const toasts: { title: string }[] = [],
    sounds: string[] = [],
    notifications: Record<string, unknown>[] = [];
  let now = 0,
    cleanup: (() => void) | undefined;
  const stores: Record<string, unknown> = {
    "../store/audioStore": { useAudioStore: audio },
    "../store/roomStore": { useRoomStore: room },
    "../store/settingsStore": { useSettingsStore: settings },
    "../store/appStore": {
      useAppStore: {
        getState: () => ({ pushToast: (value: { title: string }) => toasts.push(value) }),
      },
    },
  };
  const exports = {} as { useMutedSpeechReminder(): void };
  const source = ts.transpileModule(
    readFileSync(
      new URL("../src/renderer/src/hooks/useMutedSpeechReminder.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(source, {
    exports,
    performance: { now: () => now },
    document: { hasFocus: () => focused },
    window: {
      desktopApi: {
        app: {
          notify: async (value: Record<string, unknown>) => {
            notifications.push(value);
          },
        },
      },
    },
    require: (id: string) => {
      if (id in stores) return stores[id];
      if (id === "react")
        return {
          useEffect: (effect: () => () => void) => {
            cleanup = effect();
          },
        };
      if (id === "@private-voice/shared") return { RoomLifecycleState };
      if (id === "../features/audio/mutedSpeechReminder") return reminder;
      if (id === "../features/audio/uiSound")
        return { playUiSound: (sound: string) => sounds.push(sound) };
      throw Error(id);
    },
  });
  exports.useMutedSpeechReminder();
  const speak = (start = 0, end = start + 1500) => {
    for (now = start; now <= end; now += 250)
      audio.patch({
        localDiagnostics: {
          voiceActivity: "active",
          speechProbability: 0.95,
          processingMode: "near_speech",
          remoteEchoDetected: false,
        },
      });
  };
  return {
    audio,
    room,
    settings,
    track,
    toasts,
    sounds,
    notifications,
    speak,
    setNow: (value: number) => {
      now = value;
    },
    cleanup: () => cleanup?.(),
  };
}

test("fresh local diagnostics produce one toast and soft background alert without ever unmuting or focusing", () => {
  const f = fixture();
  f.speak();
  assert.equal(f.toasts.length, 1);
  assert.equal(f.toasts[0]?.title, "你的麦克风还处于静音状态");
  assert.deepEqual(f.sounds, ["muted-speech-reminder"]);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0]?.silent, true);
  assert.notEqual(f.notifications[0]?.attention, true);
  assert.notEqual(f.notifications[0]?.shakeWindow, true);
  assert.equal(f.track.enabled, false);
  assert.equal(f.audio.getState().isMuted, true);
  f.speak(1750, 10000);
  assert.equal(f.toasts.length, 1);
  f.cleanup();
  assert.equal(f.audio.listeners.size + f.room.listeners.size + f.settings.listeners.size, 0);
  f.speak(61500, 64000);
  assert.equal(f.toasts.length, 1, "cleanup has no late notices");
});

test("PTT, automatic mute, phone mode, disabled reminders, ended input and leaving the room suppress alerts", () => {
  for (const mode of ["ptt", "automatic", "phone", "deafened", "off", "ended", "leave"]) {
    const f = fixture();
    if (mode === "ptt")
      f.settings.patch({
        settings: { ...f.settings.getState().settings, isPushToTalkEnabled: true },
      });
    if (mode === "automatic") f.audio.patch({ isManuallyMuted: false });
    if (mode === "phone") f.audio.patch({ phoneModeActive: true });
    if (mode === "deafened") f.audio.patch({ isDeafened: true });
    if (mode === "off")
      f.settings.patch({
        settings: { ...f.settings.getState().settings, isMutedSpeechReminderEnabled: false },
      });
    if (mode === "ended") f.track.readyState = "ended";
    if (mode === "leave")
      f.room.patch({ room: { roomId: "room-a", lifecycleState: RoomLifecycleState.Closed } });
    f.speak();
    assert.equal(f.toasts.length, 0, mode);
    assert.equal(f.sounds.length, 0, mode);
    f.cleanup();
  }
});

test("repeated store updates cannot turn a cached VAD value into sustained speech; foreground is toast only", () => {
  const f = fixture(true);
  f.speak(0, 0);
  for (let now = 250; now <= 3000; now += 250) {
    f.setNow(now);
    f.audio.patch({});
  }
  assert.equal(f.toasts.length, 0);
  f.speak(3250, 4750);
  assert.equal(f.toasts.length, 1);
  assert.equal(f.notifications.length, 0);
  f.cleanup();
});
