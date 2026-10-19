import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("phone entry feedback gates the track first and confirms only native success once", async () => {
  type State = { active: boolean; busy: boolean; error?: string; entryCue?: number };
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
      if (id === "react") return { useEffect: (effect: () => unknown) => effect() };
      if (id === "../utils/desktopApi")
        return {
          desktopApi: {
            phoneMode: {
              get: async () => ({ active: false, busy: false }),
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
            assert.equal(audio.active, true);
            sounds.push(sound);
          },
        };
      throw new Error(id);
    },
  });
  exports.usePhoneModeSync();
  await Promise.resolve();
  receive({ active: true, busy: true });
  assert.deepEqual(sounds, []);
  receive({ active: true, busy: true, entryCue: 1 });
  receive({ active: true, busy: true, entryCue: 1 });
  assert.deepEqual(sounds, ["phone-mode-enter"]);
  assert.deepEqual(toasts, [], "entry cue does not claim successful system mute");
  receive({ active: true, busy: false });
  receive({ active: true, busy: true });
  receive({ active: true, busy: false });
  assert.equal(toasts.length, 1, "device reconciliation cannot repeat success feedback");
  receive({ active: true, busy: false, error: "native mute failed" });
  assert.equal(toasts.at(-1)?.title, "系统音频状态未确认");
  assert.equal(sounds.length, 1, "failure never plays a confirmation cue");
});
