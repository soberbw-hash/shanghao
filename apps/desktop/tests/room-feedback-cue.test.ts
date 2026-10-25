import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  loadRoomEntryCue,
  loadRoomMemberJoinCue,
} from "../src/renderer/src/features/audio/roomEntryCue";

class CueWorker {
  static created: CueWorker[] = [];
  static failPost = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  terminated = false;
  request?: { sampleRate: number; cue: string };
  constructor() {
    CueWorker.created.push(this);
  }
  postMessage(request: CueWorker["request"]): void {
    if (CueWorker.failPost) throw new Error("worker post failed");
    this.request = request;
  }
  terminate(): void {
    this.terminated = true;
  }
  complete(left = new Float32Array([0.1, 0.2]), right = new Float32Array([0.3, 0.4])): void {
    this.onmessage?.({ data: { left, right } });
  }
}

const setup = (t: TestContext) => {
  const originalWorker = globalThis.Worker;
  const originalWindow = globalThis.window;
  CueWorker.created = [];
  CueWorker.failPost = false;
  Object.assign(globalThis, {
    Worker: CueWorker,
    window: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
  });
  t.after(() => Object.assign(globalThis, { Worker: originalWorker, window: originalWindow }));
};

const context = (sampleRate: number, failBuffer = false): AudioContext =>
  ({
    sampleRate,
    createBuffer: (_channels: number, length: number) => {
      if (failBuffer) throw new Error("buffer allocation failed");
      const channels = [new Float32Array(length), new Float32Array(length)];
      return {
        copyToChannel: (data: Float32Array, channel: number) => channels[channel]!.set(data),
        getChannelData: (channel: number) => channels[channel],
      };
    },
  }) as unknown as AudioContext;

test("entry/member warmup shares pending work only for the same cue and sample rate", async (t) => {
  setup(t);
  const first = loadRoomEntryCue(context(48_000));
  assert.equal(loadRoomEntryCue(context(48_000)), first);
  const member = loadRoomMemberJoinCue(context(48_000));
  const otherRate = loadRoomEntryCue(context(44_100));
  assert.equal(CueWorker.created.length, 3);
  assert.deepEqual(
    CueWorker.created.map((worker) => worker.request),
    [
      { sampleRate: 48_000, cue: "enter-room" },
      { sampleRate: 48_000, cue: "member-join" },
      { sampleRate: 44_100, cue: "enter-room" },
    ],
  );
  CueWorker.created.forEach((worker) => worker.complete());
  const results = await Promise.all([first, member, otherRate]);
  assert.deepEqual(results[1]!.buffer.getChannelData(1), new Float32Array([0.3, 0.4]));
  assert.ok(CueWorker.created.every((worker) => worker.terminated));
});

test("worker failure rejects, releases the worker and permits a clean retry", async (t) => {
  setup(t);
  const failed = loadRoomMemberJoinCue(context(32_000));
  const worker = CueWorker.created[0]!;
  worker.onerror?.();
  await assert.rejects(failed, /unavailable/);
  assert.equal(worker.terminated, true);
  const retry = loadRoomMemberJoinCue(context(32_000));
  CueWorker.created[1]!.complete();
  await retry;
});

test("a synchronous worker post failure still terminates the worker and clears the cache", async (t) => {
  setup(t);
  CueWorker.failPost = true;
  await assert.rejects(loadRoomMemberJoinCue(context(16_000)), /post failed/);
  assert.equal(CueWorker.created[0]!.terminated, true);
  CueWorker.failPost = false;
  const retry = loadRoomMemberJoinCue(context(16_000));
  CueWorker.created[1]!.complete();
  await retry;
});

test("a stalled worker has a deadline and does not poison a later attempt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setup(t);
  const stalled = loadRoomEntryCue(context(24_000));
  const rejected = assert.rejects(stalled, /timeout/);
  t.mock.timers.tick(2_000);
  await rejected;
  assert.equal(CueWorker.created[0]!.terminated, true);
  const retry = loadRoomEntryCue(context(24_000));
  CueWorker.created[1]!.complete();
  await retry;
});

test("malformed samples and buffer allocation errors reject rather than leaving a pending cache", async (t) => {
  setup(t);
  const malformed = loadRoomEntryCue(context(22_050));
  CueWorker.created[0]!.complete(new Float32Array(2), new Float32Array(3));
  await assert.rejects(malformed, /invalid/);
  const failedAllocation = loadRoomEntryCue(context(22_050, true));
  CueWorker.created[1]!.complete();
  await assert.rejects(failedAllocation, /allocation failed/);
  const retry = loadRoomEntryCue(context(22_050));
  CueWorker.created[2]!.complete();
  await retry;
  assert.ok(CueWorker.created.every((worker) => worker.terminated));
});
