import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceMemoryRecord } from "@private-voice/shared";
import { reuseVoiceMemoryReferences } from "../src/renderer/src/features/ai/voiceMemoryReferences";
test("IPC progress retains unchanged transcript, but never hides word timestamp changes", () => {
  const previous = {
    recordingId: "one",
    transcript: [{ id: "s", text: "你好", words: [{ startMs: 1 }] }],
    speakers: [],
  } as unknown as VoiceMemoryRecord;
  const clone = structuredClone(previous);
  assert.equal(reuseVoiceMemoryReferences(previous, clone)?.transcript, previous.transcript);
  clone.transcript[0]!.words![0]!.startMs = 2;
  assert.notEqual(reuseVoiceMemoryReferences(previous, clone)?.transcript, previous.transcript);
});
