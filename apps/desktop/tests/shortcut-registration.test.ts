import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PhoneShortcut } from "../src/main/phone-shortcut";
import { UiohookKey } from "uiohook-napi";
import { QUICK_MESSAGE_SHORTCUT_COUNT, isQuickMessageShortcutSlot } from "@private-voice/shared";

// Exercise the actual controller with isolated native boundaries. Never register
// global keys on the developer's computer from a unit test.
const source = ts.transpileModule(
  readFileSync(new URL("../src/main/shortcuts.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const harness = (keyAtHookStart?: UiohookKeyboardEvent) => {
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
        configurePushToTalk(key: string, enabled: boolean): Promise<boolean>;
        getRuntimeSnapshot(): {
          mute: { applied: string | null; observed: string };
          quickMessages: { slot: number; applied: string | null; observed: string }[];
          mouseHook: { started: boolean; suppressed: boolean };
          phone: { applied: string | null; observed: string };
        };
        setMouseHookSuppressed(suppressed: boolean): void;
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
            isRegistered: (key: string) => bindings.has(key),
          },
        };
      if (id === "uiohook-napi")
        return {
          uIOhook: {
            on: (name: string, callback: (...args: unknown[]) => void) => hooks.set(name, callback),
            off: (name: string, callback: (...args: unknown[]) => void) => {
              if (hooks.get(name) === callback) hooks.delete(name);
            },
            start: () => {
              if (keyAtHookStart) hooks.get("keydown")?.(keyAtHookStart);
            },
            stop: () => undefined,
          },
        };
      if (id === "@private-voice/shared")
        return {
          isQuickMessageShortcutSlot,
          IPC_CHANNELS: {
            shortcuts: {
              quickMessageTriggered: "quick",
              muteTriggered: "mute",
              recordingMarkerTriggered: "marker",
              pushToTalkState: "push-to-talk",
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

test("phone shortcut listens before the native hook starts delivering keys", () => {
  const states: (boolean | undefined)[] = [];
  const { controller } = harness({
    keycode: UiohookKey.ArrowDown,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  });
  controller.configurePhone("ArrowDown", "hold", (active) => states.push(active));
  assert.deepEqual(states, [true], "the first key-down must not be lost during hook startup");
  controller.dispose();
});

test("game input suppression keeps the phone keyboard shortcut available", () => {
  const states: (boolean | undefined)[] = [];
  const { controller, hooks } = harness();
  controller.configurePhone("ArrowDown", "hold", (active) => states.push(active));
  controller.setMouseHookSuppressed(true);
  const key = {
    keycode: UiohookKey.ArrowDown,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  };
  hooks.get("keydown")!(key);
  hooks.get("keyup")!(key);
  assert.deepEqual(states, [true, false]);
  assert.equal(controller.getRuntimeSnapshot().phone.observed, "active");
  controller.dispose();
});

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

test("all quick-message slots remain usable after registration conflicts", async () => {
  const { controller, bindings, sent } = harness();
  for (let slot = 0; slot < QUICK_MESSAGE_SHORTCUT_COUNT; slot++) {
    const original = `Ctrl+Shift+${String.fromCharCode(65 + slot)}`;
    assert.equal(await controller.configureQuickMessage(slot, original), true);
    assert.equal(await controller.configureQuickMessage(slot, "occupied"), false);
    assert.equal(await controller.configureQuickMessage(slot, "invalid"), false);
    assert.ok(bindings.has(original));
    bindings.get(original)!();
    assert.equal(sent.at(-1)?.[2], slot);
  }
  assert.equal(bindings.size, QUICK_MESSAGE_SHORTCUT_COUNT);
  const lastSlot = QUICK_MESSAGE_SHORTCUT_COUNT - 1;
  assert.equal(await controller.configureQuickMessage(lastSlot, "Alt+8"), true);
  assert.equal(bindings.has(`Ctrl+Shift+${String.fromCharCode(65 + lastSlot)}`), false);
  await controller.configureQuickMessage(lastSlot, "");
  assert.equal(bindings.has("Alt+8"), false);
  controller.dispose();
  assert.equal(bindings.size, 0);
});

test("invalid quick-message slots never register native shortcuts", async () => {
  const { controller, bindings, registrations } = harness();
  for (const slot of [-1, QUICK_MESSAGE_SHORTCUT_COUNT, 0.5, NaN, Infinity]) {
    assert.equal(await controller.configureQuickMessage(slot, "F10"), false);
  }
  assert.equal(registrations(), 0);
  assert.equal(bindings.size, 0);
  controller.dispose();
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

test("runtime snapshot distinguishes saved registrations from observed hook state", async () => {
  const { controller, bindings } = harness();
  assert.equal(await controller.configureGlobalMute("F10"), true);
  assert.equal(await controller.configureQuickMessage(0, "Mouse4"), true);
  assert.equal(controller.getRuntimeSnapshot().mute.observed, "active");
  assert.equal(controller.getRuntimeSnapshot().quickMessages[0]?.observed, "active");

  bindings.delete("F10");
  controller.setMouseHookSuppressed(true);
  const snapshot = controller.getRuntimeSnapshot();
  assert.equal(snapshot.mute.applied, "F10");
  assert.equal(snapshot.mute.observed, "missing");
  assert.equal(snapshot.mouseHook.suppressed, true);
  assert.equal(snapshot.quickMessages[0]?.observed, "suspended");

  controller.setMouseHookSuppressed(false);
  assert.equal(controller.getRuntimeSnapshot().quickMessages[0]?.observed, "active");
  controller.dispose();
  assert.equal(controller.getRuntimeSnapshot().mute.observed, "inactive");
});

test("mouse push-to-talk releases when its modifier was released first", async () => {
  const { controller, hooks, sent } = harness();
  await controller.configurePushToTalk("Ctrl+Mouse4", true);
  const down = { button: 4, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
  hooks.get("mousedown")!(down);
  hooks.get("mousedown")!(down);
  hooks.get("mouseup")!({ ...down, ctrlKey: false });
  assert.deepEqual(
    sent.map((event) => event.slice(1)),
    [
      ["push-to-talk", true],
      ["push-to-talk", false],
    ],
  );
  hooks.get("mouseup")!(down);
  assert.equal(sent.length, 2, "a release without a held press has no effect");
  controller.dispose();
});

test("removing a held mouse binding releases push-to-talk exactly once", async () => {
  const { controller, hooks, sent } = harness();
  await controller.configurePushToTalk("Mouse4", true);
  hooks.get("mousedown")!({
    button: 4,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  });
  await controller.configurePushToTalk("", false);
  controller.dispose();
  assert.deepEqual(
    sent.map((event) => event[2]),
    [true, false],
  );
});

test("game suppression releases a held mouse binding before stopping the hook", async () => {
  const { controller, hooks, sent } = harness();
  await controller.configurePushToTalk("Mouse4", true);
  hooks.get("mousedown")!({
    button: 4,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  });
  controller.setMouseHookSuppressed(true);
  assert.deepEqual(
    sent.map((event) => event[2]),
    [true, false],
  );
  assert.equal(controller.getRuntimeSnapshot().mouseHook.started, false);
  controller.setMouseHookSuppressed(false);
  controller.dispose();
  assert.equal(sent.length, 2);
});

test("clearing the phone key during a game stops a now-unneeded native hook", async () => {
  const { controller } = harness();
  await controller.configureQuickMessage(0, "Mouse4");
  controller.configurePhone("ArrowDown", "hold", () => undefined);
  controller.setMouseHookSuppressed(true);
  assert.equal(controller.getRuntimeSnapshot().mouseHook.started, true);
  controller.configurePhone("", "hold", () => undefined);
  assert.equal(controller.getRuntimeSnapshot().mouseHook.started, false);
  assert.equal(controller.getRuntimeSnapshot().quickMessages[0]?.observed, "suspended");
  controller.setMouseHookSuppressed(false);
  assert.equal(controller.getRuntimeSnapshot().quickMessages[0]?.observed, "active");
  controller.dispose();
});

test("failed mouse push-to-talk replacement preserves the held original binding", async () => {
  const { controller, hooks, sent } = harness();
  await controller.configurePushToTalk("Mouse4", true);
  await controller.configureQuickMessage(0, "Mouse5");
  const event = { button: 4, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  hooks.get("mousedown")!(event);
  assert.equal(await controller.configurePushToTalk("Mouse5", true), false);
  assert.deepEqual(
    sent.map((message) => message[2]),
    [true],
  );
  hooks.get("mouseup")!(event);
  assert.deepEqual(
    sent.map((message) => message[2]),
    [true, false],
  );
  controller.dispose();
});
