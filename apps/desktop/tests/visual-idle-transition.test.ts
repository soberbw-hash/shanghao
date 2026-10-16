import assert from "node:assert/strict";
import test from "node:test";
import {
  updateVisualWarmupActivity,
  waitForVisualIdle,
} from "../src/renderer/src/features/visual-runtime/waitForVisualIdle";

test("optional warmup waits through join, route entrance, hide and abort", async () => {
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  let now = 0;
  let nextId = 0;
  let visible = true;
  const timers = new Map<number, { at: number; run: () => void }>();
  const idles = new Map<number, (deadline: { timeRemaining: () => number }) => void>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(windowEvents, {
      setTimeout: (run: () => void, delay: number) => {
        const id = ++nextId;
        timers.set(id, { at: now + delay, run });
        return id;
      },
      clearTimeout: (id: number) => timers.delete(id),
      requestIdleCallback: (run: (deadline: { timeRemaining: () => number }) => void) => {
        const id = ++nextId;
        idles.set(id, run);
        return id;
      },
      cancelIdleCallback: (id: number) => idles.delete(id),
    }),
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.assign(documentEvents, {
      get visibilityState() {
        return visible ? "visible" : "hidden";
      },
      hasFocus: () => visible,
    }),
  });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => now },
  });
  const tick = async (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    for (const [id, run] of [...idles]) {
      idles.delete(id);
      run({ timeRemaining: () => 12 });
    }
    await Promise.resolve();
  };
  try {
    updateVisualWarmupActivity(false, "home");
    let completed = false;
    const controller = new AbortController();
    const pending = waitForVisualIdle(controller.signal).then(() => {
      completed = true;
    });
    updateVisualWarmupActivity(true, "home");
    await tick(5_000);
    assert.equal(completed, false);
    assert.equal(timers.size, 0, "no polling while joining");
    updateVisualWarmupActivity(false, "room");
    await tick(1_199);
    assert.equal(completed, false, "reserve entrance frames");
    await tick(1);
    await pending;
    assert.equal(completed, true);

    visible = false;
    const cancelled = new AbortController();
    const hidden = waitForVisualIdle(cancelled.signal);
    assert.equal(timers.size, 0);
    const rejection = assert.rejects(hidden, { name: "AbortError" });
    cancelled.abort();
    await rejection;
    updateVisualWarmupActivity(false, "home");
    assert.equal(timers.size, 0, "aborted wait unsubscribes from transitions");
  } finally {
    for (const [name, descriptor] of [
      ["window", previousWindow],
      ["document", previousDocument],
      ["performance", previousPerformance],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
