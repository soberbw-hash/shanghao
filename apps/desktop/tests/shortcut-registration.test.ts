import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PhoneShortcut } from "../src/main/phone-shortcut";
import { UiohookKey } from "uiohook-napi";

// Exercise the actual controller with isolated native boundaries. Never register
// global keys on the developer's computer from a unit test.
const source = ts.transpileModule(
  readFileSync(new URL("../src/main/shortcuts.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const harness = () => {
  const bindings = new Map<string, () => void>();
  const sent: unknown[][] = [];
  const hooks = new Map<string, (...args: unknown[]) => void>();
  let registrations = 0;
  const module = {
    exports: {} as {
      ShortcutController: new (...args: unknown[]) => {
        configureQuickMessage(slot: number, key: string): Promise<boolean>;
        configureGlobalMute(key: string): Promise<boolean>;
        configureRecordingMarker(key: string): Promise<boolean>;
        dispose(): void;
        configurePhone(
          key: string,
          trigger: "hold" | "toggle",
          change: (active?: boolean) => void,
        ): void;
      };
    },
  };
  runInNewContext(source, {
    exports: module.exports,
    require: (id: string) => {
      if (id === "./phone-shortcut") return { PhoneShortcut };
      if (id === "electron")
        return {
          globalShortcut: {
            register: (key: string, callback: () => void) => {
              registrations++;
              if (key === "invalid") throw new Error("Invalid accelerator");
              if (key === "Space" || key === "occupied" || bindings.has(key)) return false;
              bindings.set(key, callback);
              return true;
            },
            unregister: (key: string) => bindings.delete(key),
            unregisterAll: () => bindings.clear(),
          },
        };
      if (id === "uiohook-napi")
        return {
          uIOhook: {
            on: (name: string, callback: (...args: unknown[]) => void) => hooks.set(name, callback),
            off: (name: string) => hooks.delete(name),
            start: () => undefined,
            stop: () => undefined,
          },
        };
      if (id === "@private-voice/shared")
        return {
          IPC_CHANNELS: {
            shortcuts: {
              quickMessageTriggered: "quick",
              muteTriggered: "mute",
              recordingMarkerTriggered: "marker",
            },
          },
        };
      if (id === "./safe-web-contents")
        return { sendToWindow: (...args: unknown[]) => sent.push(args) };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  const controller = new module.exports.ShortcutController(() => null);
  return { controller, bindings, hooks, sent, registrations: () => registrations };
};

test("phone Space works even when Electron refuses to reserve it", async () => {
  const { controller, hooks, registrations } = harness();
  const states: (boolean | undefined)[] = [];
  controller.configurePhone("Space", "hold", (value) => states.push(value));
  assert.equal(registrations(), 0);
  const event = {
    keycode: UiohookKey.Space,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  };
  hooks.get("keydown")!(event);
  hooks.get("keyup")!(event);
  assert.deepEqual(states, [true, false]);
  assert.equal(await controller.configureGlobalMute("Space"), false);
  assert.equal(await controller.configureRecordingMarker("Space"), false);
  assert.equal(await controller.configureQuickMessage(0, "Space"), false);
  controller.configurePhone("Space", "toggle", (value) => states.push(value));
  hooks.get("keydown")!(event);
  hooks.get("keyup")!(event);
  assert.equal(states.at(-1), undefined);
  controller.configurePhone("Mouse4", "hold", () => undefined);
  controller.configurePhone("Space", "hold", () => undefined);
  controller.dispose();
});

test("phone mouse bindings use native button events and reject bidirectional conflicts", async () => {
  const { controller, bindings, hooks } = harness();
  const states: (boolean | undefined)[] = [];
  controller.configurePhone("Mouse4", "hold", (value) => states.push(value));
  assert.equal(bindings.size, 0, "mouse buttons are not Electron keyboard accelerators");
  const event = { button: 4, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  hooks.get("mousedown")!(event);
  hooks.get("mouseup")!(event);
  assert.deepEqual(states, [true, false]);
  assert.equal(await controller.configureGlobalMute("Mouse4"), false);
  assert.equal(await controller.configureGlobalMute("Mouse5"), true);
  assert.throws(() => controller.configurePhone("Mouse5", "hold", () => undefined));
  controller.dispose();
});

test("all eight quick-message slots remain usable after registration conflicts", async () => {
  const { controller, bindings, sent } = harness();
  for (let slot = 0; slot < 8; slot++) {
    const original = `Ctrl+Shift+${slot}`;
    assert.equal(await controller.configureQuickMessage(slot, original), true);
    assert.equal(await controller.configureQuickMessage(slot, "occupied"), false);
    assert.equal(await controller.configureQuickMessage(slot, "invalid"), false);
    assert.ok(bindings.has(original));
    bindings.get(original)!();
    assert.equal(sent.at(-1)?.[2], slot);
  }
  assert.equal(bindings.size, 8);
  assert.equal(await controller.configureQuickMessage(7, "Alt+8"), true);
  assert.equal(bindings.has("Ctrl+Shift+7"), false);
  await controller.configureQuickMessage(7, "");
  assert.equal(bindings.has("Alt+8"), false);
  controller.dispose();
  assert.equal(bindings.size, 0);
});

test("mute and marker preserve their old keys on failure and avoid repeated registration", async () => {
  const { controller, bindings, registrations } = harness();
  for (const configure of [
    controller.configureGlobalMute.bind(controller),
    controller.configureRecordingMarker.bind(controller),
  ]) {
    assert.equal(await configure("F10"), true);
    const before = registrations();
    assert.equal(await configure("F10"), true);
    assert.equal(registrations(), before);
    assert.equal(await configure("occupied"), false);
    assert.equal(await configure("invalid"), false);
    assert.ok(bindings.has("F10"));
    assert.equal(await configure("F11"), true);
    assert.equal(bindings.has("F10"), false);
    await configure("");
    assert.equal(bindings.size, 0);
  }
});

test("mouse shortcut conflicts do not discard the original keyboard binding", async () => {
  const { controller, bindings } = harness();
  assert.equal(await controller.configureQuickMessage(0, "Mouse4"), true);
  assert.equal(await controller.configureQuickMessage(1, "F10"), true);
  assert.equal(await controller.configureQuickMessage(1, "Mouse4"), false);
  assert.ok(bindings.has("F10"));
  assert.equal(await controller.configureQuickMessage(1, "Mouse5"), true);
  assert.equal(bindings.has("F10"), false);
  controller.dispose();
});
