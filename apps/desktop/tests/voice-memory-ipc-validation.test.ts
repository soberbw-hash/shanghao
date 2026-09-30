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
