import assert from "node:assert/strict";
import test from "node:test";

import { requestMicrophoneStream } from "../../../packages/webrtc/src/media";

test("microphone capture retries at the device's native sample rate", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const constraints: MediaStreamConstraints[] = [];
  const stream = {
    getAudioTracks: () => [{ getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }) }],
  } as unknown as MediaStream;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (requested: MediaStreamConstraints) => {
          constraints.push(requested);
          if (constraints.length === 1)
            throw new DOMException("Device rejected rate", "NotReadableError");
          return stream;
        },
      },
    },
  });
  try {
    const result = await requestMicrophoneStream({ noiseSuppression: false });
    assert.equal(result.stream, stream);
    assert.equal(result.diagnostics.sampleRateFallbackApplied, true);
    assert.equal(result.diagnostics.actualSampleRate, 48_000);
    assert.equal(constraints.length, 2);
    assert.equal((constraints[1].audio as MediaTrackConstraints).sampleRate, undefined);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("speaker changes remain ordered when an earlier route is still pending", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { desktopApi: { app: { writeLog: async () => undefined } } },
  });
  try {
    const { RemoteAudioMixer } =
      await import("../src/renderer/src/features/audio/RemoteAudioMixer");
    const calls: string[] = [];
    let finishFirst: (() => void) | undefined;
    const mixer = new RemoteAudioMixer();
    Object.assign(mixer, {
      context: {
        state: "running",
        currentTime: 0,
        setSinkId: (sinkId: string) => {
          calls.push(sinkId);
          if (sinkId === "headset")
            return new Promise<void>((resolve) => {
              finishFirst = resolve;
            });
          return Promise.resolve();
        },
      },
    });

    const first = mixer.setOutputDevice("headset");
    await Promise.resolve();
    const second = mixer.setOutputDevice("speakers");
    assert.deepEqual(calls, ["headset"]);
    finishFirst?.();
    await Promise.all([first, second]);
    assert.deepEqual(calls, ["headset", "speakers"]);
    assert.equal(mixer.getDiagnostics().outputDeviceId, "speakers");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a stale speaker failure does not replace a newer selection with default", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { desktopApi: { app: { writeLog: async () => undefined } } },
  });
  try {
    const { RemoteAudioMixer } =
      await import("../src/renderer/src/features/audio/RemoteAudioMixer");
    const calls: string[] = [];
    let failFirst: ((reason: Error) => void) | undefined;
    const mixer = new RemoteAudioMixer();
    Object.assign(mixer, {
      context: {
        state: "running",
        currentTime: 0,
        setSinkId: (sinkId: string) => {
          calls.push(sinkId);
          if (sinkId === "missing") {
            return new Promise<void>((_resolve, reject) => {
              failFirst = reject;
            });
          }
          return Promise.resolve();
        },
      },
    });

    const first = mixer.setOutputDevice("missing");
    await Promise.resolve();
    const second = mixer.setOutputDevice("speakers");
    failFirst?.(new Error("Device disconnected"));
    await Promise.all([first, second]);
    assert.deepEqual(calls, ["missing", "speakers"]);
    assert.equal(mixer.getDiagnostics().outputDeviceId, "speakers");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
