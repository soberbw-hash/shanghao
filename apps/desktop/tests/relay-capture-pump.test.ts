import assert from "node:assert/strict";
import test from "node:test";
import { RelayCapturePump } from "../src/renderer/src/features/audio/RelayCapturePump";
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("brief send pressure queues PCM, but late callbacks and prolonged backlog never replay stale speech", async () => {
  let now = 1000,
    release!: () => void;
  const sent: number[] = [];
  const pump = new RelayCapturePump(
    async (samples) => {
      sent.push(samples[0]!);
      if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
    },
    () => now,
  );
  pump.push(new Float32Array(960).fill(1), 48000, now);
  pump.push(new Float32Array(960).fill(2), 48000, now);
  release();
  await settle();
  await settle();
  assert.deepEqual(sent, [1, 2]);
  now += 500;
  pump.push(new Float32Array(960).fill(3), 48000, now - 500);
  await settle();
  assert.deepEqual(sent, [1, 2]);
  assert.equal(pump.droppedFrames, 1);
});

test("late completion from an old audio epoch cannot unlock or drain the new epoch", async () => {
  let oldDone!: () => void, newDone!: () => void;
  const sent: number[] = [];
  const pump = new RelayCapturePump(
    async (samples) => {
      const value = samples[0]!;
      sent.push(value);
      if (value === 1) await new Promise<void>((resolve) => (oldDone = resolve));
      if (value === 2) await new Promise<void>((resolve) => (newDone = resolve));
    },
    () => 1000,
  );
  const frame = (value: number) => pump.push(new Float32Array(960).fill(value), 48000);
  frame(1);
  pump.reset();
  frame(2);
  frame(3);
  oldDone();
  await settle();
  assert.deepEqual(sent, [1, 2]);
  newDone();
  await settle();
  await settle();
  assert.deepEqual(sent, [1, 2, 3]);
});

test("a hung IPC send cannot permanently latch the microphone sender", async () => {
  let now = 1000;
  const sent: number[] = [];
  const pump = new RelayCapturePump(
    async (samples) => {
      sent.push(samples[0]!);
      if (sent.length === 1) await new Promise<void>(() => {});
    },
    () => now,
  );
  pump.push(new Float32Array(960).fill(1), 48000);
  now += 600;
  pump.push(new Float32Array(960).fill(2), 48000);
  await settle();
  assert.deepEqual(sent, [1, 2]);
});
