import assert from "node:assert/strict";
import test from "node:test";

import { requireVoiceMemoryProcessRequest } from "../src/main/voice-memory-ipc-validation";

const valid = {
  recordingId: "recording-1",
  filePath: "C:\\recordings\\voice.m4a",
  roomId: "main",
  markers: [{ id: "marker-1", offsetMs: 1234 }],
  speakingTimeline: [{ offsetMs: 1234, memberId: "friend", nickname: "朋友" }],
};

test("voice memory IPC accepts a bounded recording request", () => {
  assert.deepEqual(requireVoiceMemoryProcessRequest(valid), valid);
});

test("voice memory IPC rejects malformed and oversized timeline input", () => {
  assert.throws(
    () => requireVoiceMemoryProcessRequest(null),
    /invalid_voice_memory_process_request/,
  );
  assert.throws(
    () => requireVoiceMemoryProcessRequest({ ...valid, markers: [{ id: "bad", offsetMs: NaN }] }),
    /invalid_voice_memory_process_request/,
  );
  assert.throws(
    () => requireVoiceMemoryProcessRequest({ ...valid, speakingTimeline: [null] }),
    /invalid_voice_memory_process_request/,
  );
  assert.throws(
    () =>
      requireVoiceMemoryProcessRequest({
        ...valid,
        speakingTimeline: new Array(40_001).fill(valid.speakingTimeline[0]),
      }),
    /invalid_voice_memory_process_request/,
  );
  assert.throws(
    () => requireVoiceMemoryProcessRequest({ ...valid, roomName: "长".repeat(5 * 1024 * 1024) }),
    /invalid_voice_memory_process_request/,
  );
});

test("benchmark IPC validates nested clip ranges, keywords, environment and model identity", () => {
  const benchmark = {
    mode: "standard",
    clips: [
      {
        startMs: 0,
        endMs: 60_000,
        sourceStartMs: 10_000,
        sourceEndMs: 70_000,
        groundTruthText: "测试",
        importantKeywords: ["上号"],
      },
    ],
    environment: { gpuTotalVramMb: 8192, ramMb: 32768, pipelineVersion: 8, gpu: "4060 Ti" },
  };
  assert.deepEqual(requireVoiceMemoryProcessRequest({ ...valid, benchmark }).benchmark, benchmark);
  for (const badBenchmark of [
    { clips: [null] },
    { clips: ["clip"] },
    { clips: [{}] },
    { clips: [{ startMs: 100, endMs: 99 }] },
    { clips: [{ startMs: 0, endMs: Infinity }] },
    { clips: [{ startMs: 0, endMs: 100, sourceStartMs: 500, sourceEndMs: 400 }] },
    { clips: [{ startMs: 0, endMs: 100, importantKeywords: [42] }] },
    { mode: "anything" },
    { environment: [] },
    { environment: { gpuTotalVramMb: NaN } },
    { environment: { pipelineVersion: 1.5 } },
    { environment: { cpu: {} } },
  ]) {
    assert.throws(
      () => requireVoiceMemoryProcessRequest({ ...valid, benchmark: badBenchmark }),
      /invalid_voice_memory_process_request/,
    );
  }
  for (const asrModelId of ["unknown", "toString", 42]) {
    assert.throws(
      () => requireVoiceMemoryProcessRequest({ ...valid, asrModelId }),
      /invalid_voice_memory_process_request/,
    );
  }
});
