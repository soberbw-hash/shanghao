import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { IPC_CHANNELS } from "@private-voice/shared";
import * as shared from "@private-voice/shared";
import { create } from "zustand";
import { createDeviceRefreshVersion } from "../src/renderer/src/features/audio/deviceRecovery";
import { PhoneShortcut } from "../src/main/phone-shortcut";
import { UiohookKey, type UiohookKeyboardEvent } from "uiohook-napi";

type State = { active: boolean; busy: boolean; error?: string };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const harness = (onState: (state: State) => void = () => undefined) => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const states: State[] = [];
  const commands: { id: number; active: boolean }[] = [];
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new PassThrough(),
    stdin: new Writable({
      write(chunk, _encoding, done) {
        commands.push(JSON.parse(String(chunk)));
        done();
      },
    }),
  });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    getAppPath: () => "/test",
    getPath: () => "/test",
  });
  const power = new EventEmitter();
  const frame = {};
  const window = { webContents: { id: 1, mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  let binding: PhoneShortcut;
  const exports = {} as { registerPhoneMode: (...args: unknown[]) => void };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/main/phone-mode-service.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  runInNewContext(source, {
    exports,
    setTimeout,
    clearTimeout,
    require: (id: string) => {
      if (id === "node:child_process") return { spawn: () => child };
      if (id === "node:path") return path;
      if (id === "node:readline") return { createInterface };
      if (id === "electron")
        return {
          app,
          powerMonitor: power,
          ipcMain: {
            handle: (name: string, callback: (...args: unknown[]) => unknown) =>
              handlers.set(name, callback),
          },
        };
      if (id === "@private-voice/shared") return { IPC_CHANNELS };
      if (id === "./safe-web-contents")
        return {
          sendToWindow: (_window: unknown, _channel: unknown, state: State) => {
            states.push(state);
            onState(state);
          },
        };
      if (id === "./platform/PlatformService") return { platformService: { isWindows: true } };
      throw new Error(id);
    },
  });
  exports.registerPhoneMode(
    () => window,
    {
      getSnapshot: () => ({ phoneModeShortcut: "ArrowDown", phoneModeTrigger: "hold" }),
      save: async () => undefined,
    },
    {
      configurePhone: (
        key: string,
        trigger: "hold" | "toggle",
        change: (active?: boolean) => void,
      ) => {
        binding = PhoneShortcut.parse(key, trigger, change);
      },
      resetPhonePress: () => binding.reset(),
    },
  );
  const key = {
    keycode: UiohookKey.ArrowDown,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  } as UiohookKeyboardEvent;
  const reply = (value: object) => stdout.write(JSON.stringify(value) + "\n");
  const ack = (command: (typeof commands)[number], error?: string) => reply({ ...command, error });
  return {
    states,
    commands,
    power,
    ready: () => reply({ ready: true, active: false }),
    press: () => binding.keyDown(key),
    release: () => binding.keyUp(key),
    ack,
    reply,
    set: (active: boolean) =>
      handlers.get(IPC_CHANNELS.phoneMode.set)!(event, active) as Promise<void>,
    devices: () =>
      handlers.get(IPC_CHANNELS.phoneMode.devices)!(event, {
        inputDeviceId: "new-input",
        outputDeviceId: "new-output",
      }),
    configureToggle: () =>
      handlers.get(IPC_CHANNELS.phoneMode.configure)!(event, "ArrowDown", "toggle"),
    close: () => {
      app.emit("before-quit");
      child.emit("exit", 0);
    },
  };
};

test("rapid ArrowDown hold presses discard obsolete native operations and restore only after ACK", async () => {
  const h = harness();
  try {
    h.ready();
    h.press();
    await tick();
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].active, true);
    h.release();
    for (let index = 0; index < 100; index++) {
      h.press();
      h.press();
      h.release();
    }
    assert.equal(h.commands.length, 1, "one in-flight native request");
    assert.equal(
      h.states.at(-1)?.active,
      true,
      "preserve the initial audio snapshot until verified restore",
    );
    h.ack(h.commands[0]);
    await tick();
    assert.equal(
      h.commands.length,
      2,
      "skip the 200 obsolete transitions instead of replaying them",
    );
    assert.equal(h.commands[1].active, false);
    h.power.emit("resume");
    h.devices();
    assert.equal(h.commands.length, 2, "resume/device refresh cannot reverse a pending release");
    h.ack(h.commands[1]);
    await tick();
    assert.equal(h.states.at(-1)?.active, false);
    assert.equal(h.states.at(-1)?.busy, false);
    h.reply({ id: 999, active: true, error: "stale timed-out native reply" });
    assert.equal(h.states.at(-1)?.active, false);
    h.press();
    await tick();
    h.ack(h.commands[2]);
    await tick();
    h.release();
    await tick();
    h.ack(h.commands[3]);
    await tick();
    assert.equal(h.states.at(-1)?.active, false, "the next normal press still works");
  } finally {
    h.close();
  }
});

test("release during startup wins without replaying the rapid taps", async () => {
  const h = harness();
  try {
    for (let index = 0; index < 100; index++) {
      h.press();
      h.release();
    }
    h.ready();
    await tick();
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].active, false);
    h.ack(h.commands[0]);
    await tick();
    assert.equal(h.states.at(-1)?.active, false);
  } finally {
    h.close();
  }
});

test("a fresh press during restore stays muted and a failed restore can be retried", async () => {
  const h = harness();
  try {
    h.ready();
    h.press();
    await tick();
    h.ack(h.commands[0]);
    await tick();
    h.release();
    await tick();
    h.press();
    h.ack(h.commands[1]);
    await tick();
    assert.equal(
      h.states.at(-1)?.active,
      true,
      "old release cannot open the mic during the new hold",
    );
    h.ack(h.commands[2]);
    await tick();
    h.release();
    await tick();
    h.ack(h.commands[3], "restore failed");
    await tick();
    assert.equal(h.states.at(-1)?.active, true);
    assert.ok(h.states.at(-1)?.error);
    await h.configureToggle();
    h.press();
    h.release();
    await tick();
    assert.equal(
      h.commands[4].active,
      false,
      "toggle after failure retries restore instead of reactivating",
    );
    h.ack(h.commands[4]);
    await tick();
    assert.equal(h.states.at(-1)?.active, false);
  } finally {
    h.close();
  }
});

test("toggle requests follow latest intent while native audio is busy", async () => {
  const h = harness();
  try {
    h.ready();
    await h.configureToggle();
    h.press();
    h.release();
    await tick();
    h.press();
    h.release();
    h.press();
    h.release();
    h.ack(h.commands[0]);
    await tick();
    assert.equal(
      h.commands.at(-1)?.active,
      true,
      "three toggles end active despite a pending native ACK",
    );
    h.ack(h.commands.at(-1)!);
    await tick();
    const ending = h.set(false);
    await tick();
    h.ack(h.commands.at(-1)!);
    await ending;
    assert.equal(h.states.at(-1)?.active, false);
  } finally {
    h.close();
  }
});

test("rapid hold cycles preserve all original renderer microphone and speaker states", async () => {
  type Audio = { isMuted: boolean; isDeafened: boolean; setPhoneMode(active: boolean): void };
  for (const isMuted of [false, true])
    for (const isDeafened of [false, true]) {
      const exports = {} as {
        useAudioStore: { getState(): Audio; setState(state: Partial<Audio>): void };
      };
      const source = ts.transpileModule(
        readFileSync(new URL("../src/renderer/src/store/audioStore.ts", import.meta.url), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
      ).outputText;
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
      store.setState({ isMuted, isDeafened });
      const h = harness((state) => store.getState().setPhoneMode(state.active));
      try {
        h.ready();
        h.press();
        await tick();
        for (let index = 0; index < 100; index++) {
          h.release();
          h.press();
        }
        h.release();
        h.ack(h.commands[0]);
        await tick();
        assert.equal(store.getState().isMuted, true);
        assert.equal(store.getState().isDeafened, true);
        h.ack(h.commands[1]);
        await tick();
        assert.equal(store.getState().isMuted, isMuted);
        assert.equal(store.getState().isDeafened, isDeafened);
      } finally {
        h.close();
      }
    }
});
