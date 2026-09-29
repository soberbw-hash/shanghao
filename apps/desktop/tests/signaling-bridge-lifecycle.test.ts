import assert from "node:assert/strict";
import test from "node:test";

import type { SignalingEventPayload } from "@private-voice/shared";

test("reconnecting a signaling bridge skips queued events and failures from its old connection", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const listeners = new Set<(payload: SignalingEventPayload) => void>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        signaling: {
          onEvent: (listener: (payload: SignalingEventPayload) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          connect: async () => undefined,
          close: async () => undefined,
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const { SignalingBridge } = await import("../src/renderer/src/features/room/SignalingBridge");
  const bridge = new SignalingBridge();
  const handled: string[] = [];
  const failures: unknown[] = [];
  let rejectOld: ((error: Error) => void) | undefined;
  await bridge.connect(
    "ws://127.0.0.1:1/",
    async (payload) => {
      handled.push(payload.data ?? "");
      if (payload.data === "old-running") {
        await new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        });
      }
    },
    (error) => failures.push(error),
  );
  const emit = (data: string) => {
    for (const listener of listeners) {
      listener({ sessionId: bridge.sessionId, type: "message", data });
    }
  };
  emit("old-running");
  emit("old-queued");
  await Promise.resolve();
  assert.ok(rejectOld);

  await bridge.connect(
    "ws://127.0.0.1:1/",
    async (payload) => {
      handled.push(payload.data ?? "");
    },
    (error) => failures.push(error),
  );
  emit("new");
  await Promise.resolve();
  assert.deepEqual(handled, ["old-running", "new"]);

  rejectOld(new Error("stale_failure"));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(handled, ["old-running", "new"]);
  assert.deepEqual(failures, []);
  await bridge.close();
});

test("a delayed close from the previous attempt cannot close a newer signaling session", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let activeSession: string | undefined;
  let finishOldClose: (() => void) | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        signaling: {
          onEvent: () => () => undefined,
          connect: async (_url: string, sessionId: string) => {
            activeSession = sessionId;
          },
          close: (sessionId: string) =>
            new Promise<void>((resolve) => {
              finishOldClose = () => {
                if (activeSession === sessionId) activeSession = undefined;
                resolve();
              };
            }),
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const { SignalingBridge } = await import("../src/renderer/src/features/room/SignalingBridge");
  const bridge = new SignalingBridge();
  const onEvent = async () => undefined;
  const onFailure = () => undefined;
  await bridge.connect("ws://127.0.0.1:1/", onEvent, onFailure);
  const oldSession = bridge.sessionId;
  const oldClose = bridge.close();
  await bridge.connect("ws://127.0.0.1:1/", onEvent, onFailure);
  const newSession = bridge.sessionId;
  assert.notEqual(newSession, oldSession);
  assert.equal(activeSession, newSession);
  assert.ok(finishOldClose);
  finishOldClose();
  await oldClose;
  assert.equal(activeSession, newSession);
});
