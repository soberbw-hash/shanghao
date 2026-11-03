import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ChronicleMicrophoneCapture } from "../src/renderer/src/features/room/ChronicleMicrophoneCapture";
import type { ChronicleAudioPart } from "../src/renderer/src/features/room/RoomChronicleClient";

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let elapsed = 0,
    trackStops = 0;
  t.mock.method(performance, "now", () => elapsed);
  const recorders: Recorder[] = [],
    sent: ChronicleAudioPart[] = [],
    statuses: string[] = [];
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    behavior: "normal" | "missing-stop" | "throw" = "normal";
    onstop?: (() => void) | null;
    onerror?: (() => void) | null;
    ondataavailable?: ((event: { data: Blob }) => void) | null;
    constructor() {
      recorders.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      if (this.behavior === "throw") throw Error("lost encoder");
      this.state = "inactive";
      if (this.behavior === "normal") {
        this.ondataavailable?.({ data: new Blob(["synthetic audio"]) });
        this.onstop?.();
      }
    }
  }
  for (const [name, value] of [
    ["MediaRecorder", Recorder],
    ["MediaStream", class {}],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
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
    async (part) => {
      sent.push(part);
    },
    (message) => statuses.push(message),
  );
  t.after(() => {
    capture.stop();
    t.mock.timers.reset();
    assert.equal(trackStops, 0);
  });
  capture.start();
  return {
    capture,
    recorders,
    sent,
    statuses,
    advance(ms: number) {
      elapsed += ms;
      t.mock.timers.tick(ms);
    },
  };
}

test("scheduled recorder stop failure automatically recovers without manual intervention", (t) => {
  const f = fixture(t);
  f.recorders[0]!.behavior = "throw";
  assert.doesNotThrow(() => f.advance(30_000));
  assert.equal(f.recorders[0]!.onstop, null);
  f.advance(9_999);
  assert.equal(f.recorders.length, 1);
  f.advance(1);
  assert.equal(f.recorders.length, 2);
  assert.equal(f.recorders[1]!.state, "recording");
  assert.equal(f.sent.length, 0);
});

test("missing final stop event has a deadline, and start cannot overwrite a pending encoder", (t) => {
  const f = fixture(t);
  f.recorders[0]!.behavior = "missing-stop";
  f.advance(30_000);
  f.capture.start();
  assert.equal(f.recorders.length, 1);
  f.advance(2_000);
  f.advance(10_000);
  assert.equal(f.recorders.length, 2);
  assert.equal(f.sent.length, 0);
});

test("encoder error without a stop event recovers, repeated errors do not postpone recovery", (t) => {
  const f = fixture(t);
  const first = f.recorders[0]!;
  first.behavior = "missing-stop";
  first.onerror?.();
  f.advance(1_900);
  first.onerror?.();
  f.advance(100);
  assert.equal(first.onstop, null);
  f.advance(10_000);
  assert.equal(f.recorders.length, 2);
  assert.equal(f.sent.length, 0);
});

test("late old recorder events cannot clear the next segment's rotation or add old data", async (t) => {
  const f = fixture(t);
  const first = f.recorders[0]!;
  const oldStop = first.onstop!,
    oldError = first.onerror!,
    oldData = first.ondataavailable!;
  f.advance(30_000);
  assert.equal(f.recorders.length, 2);
  oldStop();
  oldError();
  oldData({ data: new Blob(["stale"]) });
  f.advance(30_000);
  assert.equal(f.recorders.length, 3, "the fresh segment's timer must still fire");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.sent.length, 1);
  f.advance(0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.sent.length, 2);
  assert.ok(
    f.sent.every((part) => part.durationMs === 30_000 && atob(part.data) === "synthetic audio"),
  );
  assert.equal(f.statuses.filter((message) => message.includes("暂不可用")).length, 0);
});

test("late rollover after suspension discards an overlong segment instead of falsifying its duration", async (t) => {
  const f = fixture(t);
  f.advance(90_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.sent.length, 0);
  assert.equal(f.recorders.length, 2, "fresh capture resumes without a user action");
  f.advance(30_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0]!.durationMs, 30_000);
});

test("withdrawal cancels both terminal-event deadline and deferred recovery", (t) => {
  const f = fixture(t);
  f.recorders[0]!.behavior = "missing-stop";
  f.advance(30_000);
  const oldStop = f.recorders[0]!.onstop!;
  f.capture.stop();
  oldStop();
  f.advance(60_000);
  assert.equal(f.recorders.length, 1);
  assert.equal(f.sent.length, 0);
});
