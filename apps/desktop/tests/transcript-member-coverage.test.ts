import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { resolveTranscriptView } from "../src/renderer/src/features/ai/transcriptView";
import type { VoiceMemoryRecord } from "@private-voice/shared";

test("partial independent-track transcripts show missing members and honest audio-window timing", () => {
  const record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "synthetic", filePath: "synthetic.wav" }),
    transcriptionModel: { id: "siliconflow-sensevoice-small", name: "cloud" },
    transcript: [
      {
        id: "a",
        recordingId: "synthetic",
        memberId: "member-a",
        speakerId: "member-a",
        text: "下路集合。",
        startMs: 5000,
        endMs: 6000,
      },
    ],
    remoteTranscription: {
      modelId: "siliconflow-sensevoice-small",
      partMs: 30000,
      audioDurationMs: 60000,
      parts: [],
      sources: ["member-a", "member-b"].map((speakerId) => ({
        id: speakerId,
        speakerId,
        displayNameSnapshot: "合成成员",
        startMs: 0,
        durationMs: 60000,
      })),
    },
  };
  assert.equal(resolveTranscriptView(record)?.memberCoverage, "已识别 1/2 人");
  assert.equal(resolveTranscriptView(record)?.timingLabel, "语音段定位");
  assert.equal(
    resolveTranscriptView(record)?.estimated,
    true,
    "energy windows are not word alignment",
  );
  record.transcript.push({
    ...record.transcript[0]!,
    id: "b",
    memberId: "member-b",
    speakerId: "member-b",
  });
  assert.equal(resolveTranscriptView(record)?.memberCoverage, "2人独立音轨");
  delete record.remoteTranscription!.partMs;
  assert.equal(
    resolveTranscriptView(record)?.timingLabel,
    undefined,
    "legacy estimated text must not claim new timing",
  );
});
