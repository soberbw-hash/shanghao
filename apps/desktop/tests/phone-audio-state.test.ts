import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { create } from "zustand";
import * as shared from "@private-voice/shared";
import ts from "typescript";

import { createDeviceRefreshVersion } from "../src/renderer/src/features/audio/deviceRecovery";

test("phone mode restores every pre-existing mic/speaker combination without overriding settings", () => {
  const source = ts.transpileModule(
    readFileSync(new URL("../src/renderer/src/store/audioStore.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  type Audio = {
    isMuted: boolean;
    isDeafened: boolean;
    phoneModeActive: boolean;
    setPhoneMode(active: boolean): void;
    setPhoneModeResumeState(state: {
      isMuted: boolean;
      isDeafened: boolean;
      isManuallyMuted: boolean;
    }): void;
    toggleMicrophone(): void;
    toggleDeafen(): void;
    setMuted(active: boolean): void;
    setDeafened(active: boolean): void;
    setListenOnly(active: boolean): void;
  };
  const exports = {} as {
    useAudioStore: { getState(): Audio; setState(value: Partial<Audio>): void };
  };
  runInNewContext(source, {
    exports,
    require: (id: string) => {
      if (id === "zustand") return { create };
      if (id === "@private-voice/shared") return shared;
      if (id === "../features/audio/deviceRecovery") return { createDeviceRefreshVersion };
      if (id === "@private-voice/webrtc" || id === "../utils/logger") return {};
      throw new Error(id);
    },
  });
  const store = exports.useAudioStore;
  store.getState().setListenOnly(true);
  store.getState().setMuted(false);
  store.getState().toggleMicrophone();
  store.getState().toggleDeafen();
  store.getState().toggleDeafen();
  store.getState().setPhoneMode(true);
  store.getState().setPhoneMode(false);
  assert.equal(store.getState().isMuted, true, "receive-only cannot accidentally unmute");
  store.getState().setListenOnly(false);
  for (const isMuted of [false, true])
    for (const isDeafened of [false, true]) {
      store.setState({ isMuted, isDeafened });
      store.getState().setPhoneMode(true);
      store.getState().setPhoneMode(true);
      store.getState().toggleMicrophone();
      store.getState().toggleDeafen();
      store.getState().setMuted(false);
      store.getState().setDeafened(false);
      assert.equal(store.getState().isMuted, true);
      assert.equal(store.getState().isDeafened, true);
      store.getState().setPhoneMode(false);
      assert.equal(store.getState().isMuted, isMuted);
      assert.equal(store.getState().isDeafened, isDeafened);
      assert.equal(store.getState().phoneModeActive, false);
    }
  store.getState().setPhoneMode(true);
  store
    .getState()
    .setPhoneModeResumeState({ isMuted: false, isDeafened: false, isManuallyMuted: false });
  assert.equal(
    store.getState().isMuted,
    true,
    "planning the return state must not open active phone audio",
  );
  assert.equal(store.getState().isDeafened, true);
  store.getState().setPhoneMode(false);
  assert.equal(store.getState().isMuted, false);
  assert.equal(store.getState().isDeafened, false);
  store.getState().setListenOnly(true);
  store.getState().setPhoneMode(true);
  store
    .getState()
    .setPhoneModeResumeState({ isMuted: false, isDeafened: false, isManuallyMuted: false });
  store.getState().setPhoneMode(false);
  assert.equal(
    store.getState().isMuted,
    true,
    "receive-only still wins over a planned return state",
  );
});
