import assert from "node:assert/strict";
import test from "node:test";

import type { VoiceMemoryRecord, VoiceMemoryTranscriptSegment } from "@private-voice/shared";

import {
  materializeOrganizationChunks,
  normalizeOrganizationResult,
  participantSpeakingShares,
  planRecordingOrganizationChunks,
  transcriptForOrganizationChunk,
} from "../src/main/recording-organizer";

const transcriptSegment = (
  index: number,
  startMs: number,
  speakerId = index % 2 === 0 ? "member-a" : "member-b",
): VoiceMemoryTranscriptSegment => ({
  id: `segment-${index}`,
  recordingId: "long-recording",
  startMs,
  endMs: startMs + (speakerId === "member-a" ? 40_000 : 20_000),
  text: `这是第${index + 1}段真实的朋友游戏聊天内容，不应被遗漏或重复。`,
  speakerId,
  nickname: speakerId === "member-a" ? "Sober" : "朋友",
  confidence: "high",
});

const longRecord = (): VoiceMemoryRecord => {
  const transcript = Array.from({ length: 55 }, (_, index) =>
    transcriptSegment(index, index * 10 * 60_000),
  );
  return {
    schemaVersion: 1,
    recordingId: "long-recording",
    filePath: "C:\\recordings\\long-recording.m4a",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    phase: "ready",
    progress: 100,
    speakers: [],
    transcript,
    summary: [],
    chapters: [],
    highlights: [],
    markerTitles: [],
    timeline: [],
  };
};

test("long recording organization chunks cover every reliable segment exactly once", () => {
  const record = longRecord();
  const plans = planRecordingOrganizationChunks(record);
  assert.ok(plans.length >= 8, "nine-hour transcript should be split into multiple chunks");
  const ids = plans.flatMap((plan) => plan.sourceSegmentIds);
  assert.equal(ids.length, record.transcript.length);
  assert.deepEqual(
    ids,
    record.transcript.map((segment) => segment.id),
  );
  assert.equal(new Set(ids).size, ids.length);
  for (let index = 1; index < plans.length; index += 1) {
    assert.ok((plans[index]?.startMs ?? 0) > (plans[index - 1]?.endMs ?? 0));
  }
});

test("busy recordings split below the real 8GB FreeToken KV limit", () => {
  const record = longRecord();
  record.transcript = Array.from({ length: 180 }, (_, index) => ({
    ...transcriptSegment(index, index * 60_000),
    text: `第${index + 1}段` + "这是一段持续讲话的开黑语音内容".repeat(14),
  }));
  const plans = planRecordingOrganizationChunks(record);
  assert.ok(plans.length > 8);
  assert.ok(
    plans.length < record.transcript.length / 2,
    "natural-boundary scoring must not regress into one tiny chunk per transcript segment",
  );
  assert.ok(
    plans.every((plan) => plan.estimatedInputTokens <= 3_200),
    "dense input plus a complete structured answer must fit the measured 8,218-token KV pool",
  );
});

test("completed organization chunks survive restart while running chunks become pending", () => {
  const plans = planRecordingOrganizationChunks(longRecord()).slice(0, 2);
  const initial = materializeOrganizationChunks(plans, undefined);
  const restored = materializeOrganizationChunks(plans, [
    { ...initial[0]!, status: "completed", result: normalizeOrganizationResult({}, longRecord()) },
    { ...initial[1]!, status: "running" },
  ]);
  assert.equal(restored[0]?.status, "completed");
  assert.equal(restored[1]?.status, "pending");
});

test("speaker speaking share is calculated from real transcript duration", () => {
  const shares = participantSpeakingShares(longRecord());
  assert.equal(shares.length, 2);
  assert.equal(
    Number(shares.reduce((sum, item) => sum + (item.speakingSharePercent ?? 0), 0).toFixed(1)),
    100,
  );
  assert.ok((shares[0]?.speakingSharePercent ?? 0) > (shares[1]?.speakingSharePercent ?? 0));
  assert.equal(shares[0]?.nickname, "Sober");
});

test("organization input uses readable dialogue paragraphs without word-level timing noise", () => {
  const record = longRecord();
  record.transcript = Array.from({ length: 6 }, (_, index) => ({
    ...transcriptSegment(index, 21 * 60_000 + index * 2_200, "member-a"),
    endMs: 21 * 60_000 + index * 2_200 + 1_700,
    text: [
      "我觉得可以。",
      "但是先等等。",
      "你先把墙补一下。",
      "然后我们再出去。",
      "这波别急。",
      "看我位置。",
    ][index]!,
    words: [
      {
        id: `word-${index}`,
        startMs: 21 * 60_000 + index * 2_200,
        endMs: 21 * 60_000 + index * 2_200 + 1_700,
        text: `词${index}`,
      },
    ],
  }));

  const input = transcriptForOrganizationChunk(record, {
    sourceSegmentIds: record.transcript.map((segment) => segment.id),
  });
  const lines = input.split("\n");

  assert.ok(lines.length >= 1 && lines.length <= 3);
  assert.match(input, /^\[21:00｜Sober｜speakerId=member-a｜sourceSegmentIds=segment-0,/);
  assert.match(input, /我觉得可以。/);
  assert.match(input, /然后我们再出去。/);
  assert.doesNotMatch(input, /startMs=|endMs=|word-\d/);
  for (const segment of record.transcript) assert.match(input, new RegExp(segment.id));
});
