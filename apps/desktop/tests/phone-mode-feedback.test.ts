import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as audioSendGate from "../src/renderer/src/features/audio/audioSendGate";

type State = { active: boolean; busy: boolean; error?: string; entryCue?: number };
function fixture(initial: State | Promise<State> = { active: false, busy: false }) {
  let receive!: (state: State) => void;
  const track = { enabled: true };
  const sounds: string[] = [];
  const toasts: { title: string }[] = [];
  const audio = {
    active: false,
    setPhoneMode(active: boolean) {
      this.active = active;
    },
  };
  const emptySubscribe = () => () => undefined;
  const stores: Record<string, unknown> = {
    "../store/audioStore": { useAudioStore: { getState: () => audio, subscribe: emptySubscribe } },
    "../store/roomStore": {
      useRoomStore: { getState: () => ({ localStream: { getAudioTracks: () => [track] } }) },
    },
    "../store/settingsStore": {
      useSettingsStore: { getState: () => ({}), subscribe: emptySubscribe },
    },
    "../store/appStore": {
      useAppStore: {
        getState: () => ({ pushToast: (toast: { title: string }) => toasts.push(toast) }),
      },
    },
  };
  const exports = {} as { usePhoneModeSync(): void };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/renderer/src/hooks/usePhoneModeSync.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  runInNewContext(source, {
    exports,
    require: (id: string) => {
      if (id in stores) return stores[id];
      if (id === "../features/audio/audioSendGate") return audioSendGate;
      if (id === "react") return { useEffect: (effect: () => unknown) => effect() };
      if (id === "../utils/desktopApi")
        return {
          desktopApi: {
            phoneMode: {
              get: async () => initial,
              onChanged: (listener: typeof receive) => {
                receive = listener;
                return () => undefined;
              },
            },
          },
        };
      if (id === "../features/audio/uiSound")
        return {
          playUiSound: (sound: string) => {
            assert.equal(track.enabled, false, "outgoing audio is gated synchronously");
            assert.equal(audio.active, sound === "phone-mode-enter");
            sounds.push(sound);
          },
        };
      throw new Error(id);
    },
  });
  exports.usePhoneModeSync();
  return { receive: (state: State) => receive(state), sounds, toasts, audio, track };
}

test("phone feedback gates before an entering cue and sounds exit only after native restoration once", async () => {
  const { receive, sounds, toasts } = fixture();
  await Promise.resolve();
  receive({ active: true, busy: true });
  assert.deepEqual(sounds, []);
  receive({ active: true, busy: true, entryCue: 1 });
  receive({ active: true, busy: true, entryCue: 1 });
  assert.deepEqual(sounds, ["phone-mode-enter"], "one audible pre-mute entering cue");
  assert.deepEqual(toasts, [], "entry cue does not claim successful system mute");
  receive({ active: true, busy: false, error: "native mute failed" });
  assert.deepEqual(sounds, ["phone-mode-enter"], "failed entry cannot repeat the entering cue");
  receive({ active: true, busy: false });
  assert.deepEqual(sounds, ["phone-mode-enter"]);
  receive({ active: true, busy: true });
  receive({ active: true, busy: false });
  assert.equal(toasts.length, 2, "device reconciliation cannot repeat success feedback");
  receive({ active: true, busy: false, error: "native mute failed" });
  assert.equal(toasts.at(-1)?.title, "系统音频状态未确认");
  assert.equal(sounds.length, 1, "failure never plays a confirmation cue");
  receive({ active: true, busy: true });
  receive({ active: true, busy: false, error: "native restore failed" });
  assert.equal(sounds.length, 1, "failed restoration remains silent");
  receive({ active: true, busy: true });
  receive({ active: false, busy: false });
  receive({ active: false, busy: false });
  assert.deepEqual(sounds, ["phone-mode-enter", "phone-mode-exit"]);
  receive({ active: true, busy: true, entryCue: 2 });
  receive({ active: false, busy: false });
  assert.deepEqual(
    sounds,
    ["phone-mode-enter", "phone-mode-exit", "phone-mode-enter"],
    "cancelled entry must not claim a completed restoration",
  );
  receive({ active: true, busy: true, entryCue: 3 });
  receive({ active: true, busy: false });
  assert.deepEqual(sounds, [
    "phone-mode-enter",
    "phone-mode-exit",
    "phone-mode-enter",
    "phone-mode-enter",
  ]);
});

test("phone snapshots rebaseline quietly and a late initial snapshot cannot override a live transition", async () => {
  const restored = fixture({ active: true, busy: false });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(restored.audio.active, true);
  assert.equal(restored.track.enabled, false);
  assert.deepEqual(restored.sounds, []);
  restored.receive({ active: true, busy: true });
  restored.receive({ active: true, busy: false });
  assert.deepEqual(restored.sounds, []);
  restored.receive({ active: false, busy: false });
  assert.deepEqual(restored.sounds, ["phone-mode-exit"]);

  let deliver!: (state: State) => void;
  const late = fixture(
    new Promise<State>((resolve) => {
      deliver = resolve;
    }),
  );
  late.receive({ active: true, busy: true, entryCue: 9 });
  late.receive({ active: true, busy: false });
  deliver({ active: false, busy: false });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(late.audio.active, true);
  assert.deepEqual(late.sounds, ["phone-mode-enter"]);
});
