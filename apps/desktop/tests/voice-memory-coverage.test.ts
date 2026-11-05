import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import {
  unexaminedParticipantAudio,
  unexaminedParticipantAudioMs,
} from "../src/main/voice-memory-coverage";
import type { KnownSpeakerTranscriptionSource } from "../src/main/speaker-transcript";

const source = (
  accountIdentity: string | undefined,
  startMs: number,
  endMs: number,
): KnownSpeakerTranscriptionSource => ({
  accountIdentity,
  startMs,
  endMs,
  speakerId: accountIdentity ?? "unknown",
  displayNameSnapshot: "fixture",
  filePath: "fixture.wav",
  audioOffsetMs: 0,
});

test("coverage compares independent member tracks, merging overlapping planned ranges", () => {
  const tracks = [source("a", 0, 1000), source("a", 1000, 2000), source("b", 0, 1000)];
  const planned = [
    source("a", 100, 600),
    source("a", 500, 1200),
    source("a", 1600, 2100),
    source("b", 0, 1000),
  ];
  assert.equal(unexaminedParticipantAudioMs(tracks, planned), 500);
  assert.equal(unexaminedParticipantAudioMs(tracks, tracks), 0);
  assert.equal(unexaminedParticipantAudioMs([source("a", 0, 1000)], [source("b", 0, 1000)]), 1000);
});

test("old or missing identities are unknown, never presented as complete", () => {
  assert.equal(unexaminedParticipantAudioMs([], []), undefined);
  assert.equal(unexaminedParticipantAudioMs([source(undefined, 0, 1000)], []), undefined);
  assert.equal(
    unexaminedParticipantAudioMs([source("a", 0, 1000)], [source(undefined, 0, 1000)]),
    undefined,
  );
});

test("gaps preserve member identity and timestamps without treating silence as speech", () => {
  const tracks = [source("a", 0, 1000), source("a", 1000, 2000), source("b", 0, 1000)];
  const coverage = unexaminedParticipantAudio(tracks, [
    source("a", 200, 500),
    source("b", 0, 1000),
  ])!;
  assert.equal(coverage.unexaminedParticipantAudioMs, 1700);
  assert.deepEqual(coverage.unexaminedParticipantAudioRanges, [
    { memberId: "a", displayName: "fixture", startMs: 0, endMs: 200 },
    { memberId: "a", displayName: "fixture", startMs: 500, endMs: 2000 },
  ]);
  assert.equal(coverage.unexaminedRangesTruncated, false);
});

test("large gap lists are bounded while total duration remains accurate", () => {
  const track = source("a", 0, 600);
  const planned = Array.from({ length: 200 }, (_, i) => source("a", i * 3 + 1, i * 3 + 2));
  const coverage = unexaminedParticipantAudio([track], planned)!;
  assert.equal(coverage.unexaminedParticipantAudioMs, 400);
  assert.equal(coverage.unexaminedParticipantAudioRanges.length, 128);
  assert.equal(coverage.unexaminedRangesTruncated, true);
});

test("gap metadata survives a real isolated store restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-coverage-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const coverage = unexaminedParticipantAudio([source("a", 0, 1000)], [source("a", 0, 250)])!;
  const record = createEmptyVoiceMemoryRecord({
    recordingId: "coverage-fixture",
    filePath: "fixture.wav",
    roomId: "room-a",
  });
  const store = new VoiceMemoryStore(root);
  await store.save({
    ...record,
    transcriptionStats: {
      audioDurationMs: 1000,
      processedAudioMs: 250,
      coveredAudioMs: 250,
      totalUnits: 1,
      completedUnits: 1,
      failedUnits: 0,
      retryCount: 0,
      segmentCount: 0,
      speakerCount: 1,
      ...coverage,
    },
  });
  const reopened = await new VoiceMemoryStore(root).get(record.recordingId);
  assert.deepEqual(
    reopened?.transcriptionStats?.unexaminedParticipantAudioRanges,
    coverage.unexaminedParticipantAudioRanges,
  );
  assert.equal(reopened?.transcriptionStats?.unexaminedParticipantAudioMs, 750);
});
