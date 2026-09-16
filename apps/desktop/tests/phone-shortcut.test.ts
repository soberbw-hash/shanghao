import assert from "node:assert/strict";
import test from "node:test";
import { UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from "uiohook-napi";
import { PhoneShortcut } from "../src/main/phone-shortcut";

const event = (ctrlKey = true) =>
  ({
    keycode: UiohookKey.F10,
    ctrlKey,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  }) as UiohookKeyboardEvent;

test("arrows, editing keys, numpad and modifier combinations retain key-up ownership", () => {
  for (const key of [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Enter",
    "Tab",
    "Delete",
    "Backspace",
    "NumpadAdd",
    "Equal",
  ]) {
    for (const prefix of ["", "Ctrl+", "Ctrl+Shift+", "Alt+", "Meta+"]) {
      const states: (boolean | undefined)[] = [];
      const binding = PhoneShortcut.parse(prefix + key, "hold", (value) => states.push(value));
      const pressed = {
        ...event(false),
        keycode: UiohookKey[key as keyof typeof UiohookKey],
        ctrlKey: prefix.includes("Ctrl"),
        shiftKey: prefix.includes("Shift"),
        altKey: prefix.includes("Alt"),
        metaKey: prefix.includes("Meta"),
      };
      binding.keyDown(pressed);
      binding.keyUp({ ...event(false), keycode: pressed.keycode });
      assert.deepEqual(states, [true, false], prefix + key);
    }
  }
});

test("phone hold: twenty presses ignore repeat and release even after Ctrl", () => {
  const states: (boolean | undefined)[] = [];
  const binding = PhoneShortcut.parse("Ctrl+F10", "hold", (value) => states.push(value));
  for (let index = 0; index < 20; index++) {
    binding.keyDown(event());
    binding.keyDown(event());
    binding.keyUp(event(false));
  }
  assert.deepEqual(states, Array.from({ length: 20 }, () => [true, false]).flat());
});

test("phone toggle fires once per press; hold reset releases once", () => {
  const states: (boolean | undefined)[] = [];
  const toggle = PhoneShortcut.parse("Ctrl+F10", "toggle", (value) => states.push(value));
  toggle.keyDown(event(false));
  assert.equal(states.length, 0);
  toggle.keyDown(event());
  toggle.keyDown(event());
  toggle.keyUp(event());
  toggle.reset();
  assert.deepEqual(states, [undefined]);
  const hold = PhoneShortcut.parse("Ctrl+F10", "hold", (value) => states.push(value));
  hold.keyDown(event());
  hold.reset();
  hold.reset();
  assert.deepEqual(states, [undefined, true, false]);
  assert.throws(() => PhoneShortcut.parse("Alt+F4", "hold", () => undefined));
});

test("Space and both side buttons support hold/toggle without repeats or wrong releases", () => {
  for (const trigger of ["hold", "toggle"] as const) {
    for (const key of ["Space", "Mouse4", "Mouse5"]) {
      const states: (boolean | undefined)[] = [];
      const binding = PhoneShortcut.parse(key, trigger, (value) => states.push(value));
      const keyboard = { ...event(false), keycode: UiohookKey.Space };
      const mouse = {
        ...event(false),
        button: key === "Mouse4" ? 4 : 5,
      } as unknown as UiohookMouseEvent;
      for (let index = 0; index < 100; index++) {
        if (key === "Space") {
          binding.keyDown(keyboard);
          binding.keyDown(keyboard);
          binding.keyUp(keyboard);
        } else {
          binding.mouseDown(mouse);
          binding.mouseDown(mouse);
          binding.mouseUp({ ...mouse, button: 1 } as UiohookMouseEvent);
          binding.mouseUp(mouse);
        }
      }
      assert.deepEqual(
        states,
        Array.from({ length: 100 }, () =>
          trigger === "hold" ? [true, false] : [undefined],
        ).flat(),
      );
    }
  }
});
