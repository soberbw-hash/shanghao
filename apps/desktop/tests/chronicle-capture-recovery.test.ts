import assert from "node:assert/strict";
import test from "node:test";
import { ChronicleMicrophoneCapture } from "../src/renderer/src/features/room/ChronicleMicrophoneCapture";

test("a failed audio blob does not reject or block the next segment", async () => {
  const statuses: string[] = [];
  const sent: string[] = [];
  const capture = new ChronicleMicrophoneCapture(
    { readyState: "live", enabled: true } as MediaStreamTrack,
    "session",
    () => true,
    async (part) => {
      sent.push(part.data);
    },
    (message) => statuses.push(message),
  );
  const enqueue = (
    capture as unknown as { enqueue(blob: Blob, duration: number, start: number): Promise<void> }
  ).enqueue.bind(capture);
  const broken = new Blob(["broken"], { type: "audio/webm" });
  broken.arrayBuffer = async () => {
    throw Error("read failed");
  };
  await enqueue(broken, 30000, 1);
  assert.ok(statuses.some((message) => message.includes("读取失败")));
  await enqueue(new Blob(["audio"], { type: "audio/webm" }), 30000, 2);
  await Promise.resolve();
  assert.deepEqual(sent, ["YXVkaW8="]);
  capture.stop();
});

test("chronicle encoding retries initialization and errors with a cooldown, and withdrawal cancels recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const originalRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
  const originalStream = Object.getOwnPropertyDescriptor(globalThis, "MediaStream");
  let attempts = 0,
    sends = 0,
    trackStops = 0;
  const recorders: Recorder[] = [];
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    onstop?: (() => void) | null;
    onerror?: (() => void) | null;
    ondataavailable?: ((event: { data: Blob }) => void) | null;
    constructor() {
      attempts++;
      if (attempts === 1) throw Error("temporary encoder initialization failure");
      recorders.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.onstop?.();
    }
  }
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, "MediaStream", { configurable: true, value: class {} });
  t.after(() => {
    for (const [name, descriptor] of [
      ["MediaRecorder", originalRecorder],
      ["MediaStream", originalStream],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    t.mock.timers.reset();
  });
  const statuses: string[] = [];
  const capture = new ChronicleMicrophoneCapture(
    {
      readyState: "live",
      enabled: true,
      stop() {
        trackStops++;
      },
    } as MediaStreamTrack,
    "synthetic",
    () => true,
    async () => {
      sends++;
    },
    (status) => statuses.push(status),
  );
  try {
    capture.start();
    assert.equal(attempts, 1);
    t.mock.timers.tick(9999);
    assert.equal(attempts, 1);
    t.mock.timers.tick(1);
    assert.equal(attempts, 2);
    const recorder = recorders[0]!;
    t.mock.timers.tick(600);
    recorder.ondataavailable?.({ data: new Blob(["damaged audio"]) });
    recorder.onerror?.();
    recorder.stop();
    assert.equal(attempts, 2, "encoder error must not cause a tight restart loop");
    await Promise.resolve();
    assert.equal(sends, 0, "failed encoder bytes must not reach transcription");
    t.mock.timers.tick(10000);
    assert.equal(attempts, 3);
    recorders[1]!.onerror?.();
    recorders[1]!.stop();
    t.mock.timers.tick(10000);
    assert.equal(attempts, 4);
    const failing = recorders[2]!;
    const lateError = failing.onerror!;
    failing.stop = () => {
      throw Error("encoder disconnected while stopping");
    };
    const statusCount = statuses.length;
    capture.stop();
    assert.equal(failing.onerror, null);
    assert.equal(failing.onstop, null);
    assert.equal(failing.ondataavailable, null);
    lateError();
    assert.equal(
      statuses.length,
      statusCount,
      "late encoder events cannot overwrite a new room's status",
    );
    t.mock.timers.tick(60000);
    assert.equal(attempts, 4, "withdrawal must cancel scheduled recovery");
    assert.equal(trackStops, 0, "chronicle never owns the voice track");
    assert.ok(statuses.every((status) => !status.includes("请重新选择")));
    const queued = new ChronicleMicrophoneCapture(
      { readyState: "live", enabled: true } as MediaStreamTrack,
      "synthetic-next",
      () => true,
      async () => {},
      () => {},
    );
    queued.start();
    recorders[3]!.onerror?.();
    recorders[3]!.stop();
    queued.stop();
    t.mock.timers.tick(60000);
    assert.equal(attempts, 5, "stop also cancels an already scheduled encoder restart");
  } finally {
    capture.stop();
  }
});
