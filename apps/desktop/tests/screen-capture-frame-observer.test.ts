import assert from "node:assert/strict";
import test from "node:test";
import { observeCaptureFrames } from "../src/renderer/src/features/screen-share/observeCaptureFrames";

test("stopping while video playback starts never schedules a late frame callback", async (t) => {
  const originals = new Map(
    ["window", "document", "MediaStreamTrackProcessor"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let release!: () => void,
    callbacks = 0,
    ended = 0,
    paused = 0;
  const video = {
    muted: false,
    srcObject: null as unknown,
    play: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    pause: () => {
      paused++;
    },
    requestVideoFrameCallback: () => {
      callbacks++;
      return 1;
    },
    cancelVideoFrameCallback: () => undefined,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        remoteControl: {
          getCapture: async () => ({ captureHandle: "fixture", geometryVersion: 1 }),
          endCapture: async () => {
            ended++;
          },
          captureFrame: () => undefined,
        },
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => video },
  });
  Reflect.deleteProperty(globalThis, "MediaStreamTrackProcessor");
  const track = new EventTarget() as MediaStreamTrack;
  Object.defineProperty(track, "readyState", { value: "live" });
  let endedListeners = 0;
  const add = track.addEventListener.bind(track),
    remove = track.removeEventListener.bind(track);
  track.addEventListener = ((...args: Parameters<EventTarget["addEventListener"]>) => {
    endedListeners++;
    add(...args);
  }) as typeof track.addEventListener;
  track.removeEventListener = ((...args: Parameters<EventTarget["removeEventListener"]>) => {
    endedListeners--;
    remove(...args);
  }) as typeof track.removeEventListener;
  const stop = observeCaptureFrames({ getVideoTracks: () => [track] } as unknown as MediaStream);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  stop();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(callbacks, 0);
  assert.equal(video.srcObject, null);
  assert.equal(paused, 1);
  assert.equal(ended, 1);
  assert.equal(endedListeners, 0);
});

test("an already-ended track releases its capture handle without starting observation", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  let ended = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        remoteControl: {
          getCapture: async () => ({ captureHandle: "fixture", geometryVersion: 1 }),
          endCapture: async () => {
            ended++;
          },
          captureFrame: () => {
            throw Error("ended track cannot generate frames");
          },
        },
      },
    },
  });
  const stop = observeCaptureFrames({
    getVideoTracks: () => [{ readyState: "ended" }],
  } as unknown as MediaStream);
  await new Promise((resolve) => setTimeout(resolve, 0));
  stop();
  assert.equal(ended, 1);
});
