import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_QUICK_MESSAGE_SLOTS,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  QUICK_MESSAGE_SHORTCUT_COUNT,
  isQuickMessageShortcutSlot,
} from "@private-voice/shared";
import { formatRecordingBytes } from "../src/renderer/src/features/recording/recordingSize";

test("all voice and music shortcut slots use the controller's shared bounds", () => {
  const total = DEFAULT_QUICK_MESSAGE_SLOTS.length + DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length;
  assert.equal(DEFAULT_QUICK_MESSAGE_SLOTS.length, 8);
  assert.equal(DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length, 5);
  assert.equal(QUICK_MESSAGE_SHORTCUT_COUNT, total);
  for (let index = 0; index < total; index++) assert.equal(isQuickMessageShortcutSlot(index), true);
  for (const invalid of [-1, total, 0.5, NaN, Infinity]) {
    assert.equal(isQuickMessageShortcutSlot(invalid), false);
  }
  const controller = readFileSync(new URL("../src/main/shortcuts.ts", import.meta.url), "utf8");
  assert.match(controller, /if \(!isQuickMessageShortcutSlot\(slot\)\)/);
});

test("empty recording storage is not reported as a nonzero file", () => {
  assert.equal(formatRecordingBytes(0), "0 B");
  assert.equal(formatRecordingBytes(-1), "0 B");
  assert.equal(formatRecordingBytes(NaN), "0 B");
  assert.equal(formatRecordingBytes(512), "512 B");
  assert.equal(formatRecordingBytes(1024), "1.0 KB");
  assert.equal(formatRecordingBytes(1024 ** 2), "1.0 MB");
  assert.equal(formatRecordingBytes(1024 ** 3), "1.0 GB");
});
