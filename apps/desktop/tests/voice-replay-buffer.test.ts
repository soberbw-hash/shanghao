import test from "node:test";
import assert from "node:assert/strict";
import { VoiceReplayBuffer } from "../src/renderer/src/features/recording/voiceReplayBuffer";

test("replay snapshots retain the latest samples in time order without sharing storage", () => {
  const buffer = new VoiceReplayBuffer(2, 3);
  buffer.append(Float32Array.from([1, 2, 3, 4]));
  assert.deepEqual([...buffer.snapshot(3)], [1, 2, 3, 4]);
  buffer.append(Float32Array.from([5, 6, 7, 8]));
  const clip = buffer.snapshot(2);
  assert.deepEqual([...clip], [5, 6, 7, 8]);
  buffer.append(Float32Array.from([9, 10, 11, 12, 13, 14, 15]));
  assert.deepEqual([...buffer.snapshot(3)], [10, 11, 12, 13, 14, 15]);
  assert.deepEqual([...clip], [5, 6, 7, 8]);
  buffer.clear();
  assert.equal(buffer.snapshot(3).length, 0);
  buffer.append(Float32Array.from([16]));
  assert.deepEqual([...buffer.snapshot(3)], [16]);
});

test("replay capacity and requested duration are bounded", () => {
  assert.throws(() => new VoiceReplayBuffer(48000, 61));
  const buffer = new VoiceReplayBuffer(2, 3);
  for (const duration of [0, -1, 61, NaN, Infinity]) assert.throws(() => buffer.snapshot(duration));
});
