import test from "node:test";
import assert from "node:assert/strict";
import { automaticRecordingDeadline } from "../src/renderer/src/features/recording/automaticRecordingDeadline";
test("a returning member cancels the entire absence interval, including a late timer callback", () => {
  let callback = () => {},
    alone = true,
    saves = 0,
    cleared = 0;
  const clock = {
    setTimeout(fn: () => void, delay: number) {
      assert.equal(delay, 300000);
      callback = fn;
      return 1;
    },
    clearTimeout(id: number) {
      assert.equal(id, 1);
      cleared++;
    },
  } as Pick<Window, "setTimeout" | "clearTimeout">;
  const first = automaticRecordingDeadline(
    clock,
    () => alone,
    () => saves++,
    100,
  );
  assert.equal(first.expires, 300100);
  alone = false;
  first.cancel();
  alone = true;
  callback();
  assert.equal(cleared, 1);
  assert.equal(saves, 0);
  const second = automaticRecordingDeadline(
    clock,
    () => alone,
    () => saves++,
    280000,
  );
  assert.equal(second.expires, 580000);
  callback();
  callback();
  assert.equal(saves, 1);
});
