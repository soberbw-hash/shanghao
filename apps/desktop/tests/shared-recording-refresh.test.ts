import assert from "node:assert/strict";
import test from "node:test";
import { subscribeSharedRecordingRefresh } from "../src/renderer/src/features/recording/sharedRecordingRefresh";

test("shared refresh pauses while hidden, serializes focus/timer and removes all subscriptions", async () => {
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document;
  let tick = () => {};
  let cleared = false;
  const browser = Object.assign(new EventTarget(), {
    setInterval: (callback: () => void) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  });
  const page = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  Object.assign(globalThis, { window: browser, document: page });
  try {
    let calls = 0;
    let finish = () => {};
    const stop = subscribeSharedRecordingRefresh(() => {
      calls++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    tick();
    browser.dispatchEvent(new Event("focus"));
    assert.equal(calls, 0);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    tick();
    browser.dispatchEvent(new Event("focus"));
    assert.equal(calls, 1);
    finish();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    tick();
    assert.equal(calls, 2);
    stop();
    finish();
    assert.equal(cleared, true);
    browser.dispatchEvent(new Event("focus"));
    tick();
    assert.equal(calls, 2);
  } finally {
    Object.assign(globalThis, { window: originalWindow, document: originalDocument });
  }
});
