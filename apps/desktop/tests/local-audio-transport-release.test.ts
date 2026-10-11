import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PushToTalkState } from "@private-voice/shared";

const source = ts.transpileModule(
  readFileSync(
    new URL("../src/renderer/src/hooks/useLocalAudioTransport.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const harness = (shortcut = "Ctrl+Space") => {
  const track = { enabled: true };
  const states: PushToTalkState[] = [];
  const events = new Map<string, (event: object) => void>();
  const cleanups: (() => void)[] = [];
  const module = { exports: {} as { useLocalAudioTransport: () => void } };
  runInNewContext(source, {
    exports: module.exports,
    window: {
      addEventListener: (name: string, handler: (event: object) => void) =>
        events.set(name, handler),
      removeEventListener: (name: string) => events.delete(name),
    },
    require: (id: string) => {
      if (id === "react")
        return {
          useEffect: (effect: () => (() => void) | void) => {
            const cleanup = effect();
            if (cleanup) cleanups.push(cleanup);
          },
        };
      if (id === "@private-voice/shared") return { PushToTalkState };
      if (id === "../store/audioStore")
        return {
          useAudioStore: (select: (state: object) => unknown) =>
            select({
              isMuted: false,
              isDeafened: false,
              isPushToTalkEnabled: true,
              setPushToTalkState: (state: PushToTalkState) => states.push(state),
            }),
        };
      if (id === "../store/roomStore")
        return {
          useRoomStore: (select: (state: object) => unknown) =>
            select({ localStream: { getAudioTracks: () => [track] } }),
        };
      if (id === "../store/settingsStore")
        return {
          useSettingsStore: (select: (state: object) => unknown) =>
            select({ settings: { pushToTalkShortcut: shortcut } }),
        };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  module.exports.useLocalAudioTransport();
  return { track, states, events, dispose: () => cleanups.forEach((cleanup) => cleanup()) };
};

const space = {
  key: " ",
  code: "Space",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
};

test("keyboard PTT closes after its modifier was released first", () => {
  const state = harness();
  state.events.get("keydown")!(space);
  assert.equal(state.track.enabled, true);
  state.events.get("keyup")!({ ...space, ctrlKey: false });
  assert.equal(state.track.enabled, false);
  assert.equal(state.states.at(-1), PushToTalkState.Armed);
  state.dispose();
});

test("focus loss closes keyboard PTT and repeats cannot reopen it", () => {
  const state = harness();
  state.events.get("keydown")!(space);
  state.events.get("blur")!({});
  assert.equal(state.track.enabled, false);
  state.events.get("keydown")!({ ...space, repeat: true });
  assert.equal(state.track.enabled, false);
  state.events.get("keydown")!(space);
  assert.equal(state.track.enabled, true);
  state.dispose();
  assert.equal(state.track.enabled, false);
  assert.equal(state.events.size, 0);
});

test("unrelated release does not terminate the owned press", () => {
  const state = harness();
  state.events.get("keydown")!(space);
  state.events.get("keyup")!({ ...space, key: "a", code: "KeyA" });
  assert.equal(state.track.enabled, true);
  state.dispose();
});

test("RoomPage only changes the PTT mode after settings accept the change", () => {
  const page = readFileSync(
    new URL("../src/renderer/src/pages/RoomPage.tsx", import.meta.url),
    "utf8",
  );
  const handler = page.match(
    /onPushToTalkEnabledChange=\{\(isPushToTalkEnabled\) => \{([\s\S]*?)\n {8}\}\}/,
  )?.[1];
  assert.ok(handler);
  assert.match(handler, /saveSettings\(\{ isPushToTalkEnabled \}\)/);
  assert.doesNotMatch(handler, /setPushToTalkEnabled\(/);
});
