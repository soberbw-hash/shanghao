import assert from "node:assert/strict";
import test from "node:test";
import { createMixedCallStream } from "../src/renderer/src/features/recording/mixRoomAudio";

test("participant rotation keeps capturing while previous disk writes are pending and detach waits for both writers", async () => {
  const originals = new Map(
    ["AudioContext", "MediaRecorder", "window"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  let tick: () => void = () => {};
  let now = 0;
  const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  const captures: FakeRecorder[] = [];
  const deferred: Array<() => void> = [];
  const streams: Array<{ getTracks: () => Array<{ stop: () => void }>; stopped: boolean }> = [];
  class FakeRecorder extends EventTarget {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    constructor(public stream: unknown) {
      super();
      captures.push(this);
    }
    start() {
      this.state = "recording";
    }
    requestData() {
      this.ondataavailable?.({ data: new Blob(["audio"]) });
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => this.dispatchEvent(new Event("stop")));
    }
  }
  const node = () => ({ connect() {}, disconnect() {} });
  class FakeContext {
    currentTime = 0;
    sampleRate = 48000;
    createGain() {
      return { ...node(), gain: { setTargetAtTime() {} } };
    }
    createDynamicsCompressor() {
      return {
        ...node(),
        threshold: {},
        knee: {},
        ratio: {},
        attack: {},
        release: {},
        reduction: 0,
      };
    }
    createAnalyser() {
      return {
        ...node(),
        fftSize: 1024,
        getFloatTimeDomainData(data: Float32Array) {
          data.fill(0.05);
        },
      };
    }
    createMediaStreamSource() {
      return node();
    }
    createMediaStreamDestination() {
      const stream = {
        stopped: false,
        getTracks: () => [
          {
            stop: () => {
              stream.stopped = true;
            },
          },
        ],
      };
      streams.push(stream);
      return { ...node(), stream };
    }
    async resume() {}
    async close() {}
  }
  Object.defineProperties(globalThis, {
    AudioContext: { configurable: true, value: FakeContext },
    MediaRecorder: { configurable: true, value: FakeRecorder },
    window: {
      configurable: true,
      value: {
        setInterval: (callback: () => void) => {
          tick = callback;
          return 1;
        },
        clearInterval() {},
      },
    },
  });
  const source = {
    getAudioTracks: () => [{ id: "source-a", readyState: "live" }],
  } as unknown as MediaStream;
  let mixed: ReturnType<typeof createMixedCallStream> | undefined;
  try {
    mixed = createMixedCallStream(
      source,
      {},
      {
        loudnessBalanceEnabled: false,
        sourceIdentities: {
          __local_microphone__: {
            speakerId: "peer",
            userId: "account",
            displayNameSnapshot: "成员",
            roomId: "room",
          },
        },
        persistParticipantTrack: () => new Promise<void>((resolve) => deferred.push(resolve)),
        persistSpeakerSegment: async () => {},
      },
    );
    tick();
    now = 300000;
    tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      captures.some((capture) => capture.state === "recording"),
      "saving the old five-minute track must not leave the next track unrecorded",
    );
    assert.equal(captures.filter((capture) => capture.state === "recording").length, 1);
    const participantStream = streams[1]!;
    mixed.sync(undefined, {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      participantStream.stopped,
      false,
      "speaker-clip completion cannot stop a stream still owned by participant capture",
    );
    deferred.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(participantStream.stopped, true);
  } finally {
    deferred.splice(0).forEach((resolve) => resolve());
    mixed?.dispose();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    if (originalNow) Object.defineProperty(performance, "now", originalNow);
    else Reflect.deleteProperty(performance, "now");
  }
});
