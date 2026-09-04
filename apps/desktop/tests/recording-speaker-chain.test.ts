import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";

import {
  bindTranscriptToKnownSpeaker,
  mergeSpeakerTranscript,
  splitParticipantTracksIntoSpeakerSources,
} from "../src/main/speaker-transcript";

const recognized = (
  text: string,
  startMs: number,
  endMs: number,
): VoiceMemoryTranscriptSegment => ({
  id: "model-speaker-guess",
  recordingId: "temporary",
  startMs,
  endMs,
  text,
  speakerId: "Speaker 1",
  confidence: "pending",
});

test("known participant streams override ASR speaker guesses and retain overlapping speech", () => {
  const first = bindTranscriptToKnownSpeaker(
    "recording-1",
    0,
    { speakerId: "peer-a", displayNameSnapshot: "老王", startMs: 13_200, endMs: 15_100 },
    [recognized("他在B点", 0, 1_600)],
  );
  const second = bindTranscriptToKnownSpeaker(
    "recording-1",
    1,
    { speakerId: "peer-b", displayNameSnapshot: "小李", startMs: 13_310, endMs: 15_500 },
    [recognized("我看到了", 0, 1_200)],
  );
  const merged = mergeSpeakerTranscript(first, second);

  assert.deepEqual(
    merged.map((segment) => [segment.speakerId, segment.displayNameSnapshot, segment.startMs]),
    [
      ["peer-a", "老王", 13_200],
      ["peer-b", "小李", 13_310],
    ],
  );
  assert.ok(merged[0]!.endMs > merged[1]!.startMs);
  assert.equal(
    merged.some((segment) => segment.speakerId === "Speaker 1"),
    false,
  );
});

test("durable participant tracks keep account nicknames across reconnects and bounded chunks", () => {
  const sources = splitParticipantTracksIntoSpeakerSources(
    [
      {
        filePath: "first.webm",
        userId: "account-7",
        speakerId: "peer-before-reconnect",
        displayNameSnapshot: "Sober",
        trackId: "track-a",
        startMs: 0,
        endMs: 65_000,
      },
      {
        filePath: "second.webm",
        userId: "account-7",
        speakerId: "peer-after-reconnect",
        displayNameSnapshot: "Sober",
        trackId: "track-b",
        startMs: 70_000,
        endMs: 80_000,
      },
    ],
    80_000,
    30_000,
  );

  assert.deepEqual(
    sources.map((source) => [
      source.filePath,
      source.speakerId,
      source.displayNameSnapshot,
      source.startMs,
      source.endMs,
      source.audioOffsetMs,
    ]),
    [
      ["first.webm", "account-7", "Sober", 0, 30_000, 0],
      ["first.webm", "account-7", "Sober", 30_000, 60_000, 30_000],
      ["first.webm", "account-7", "Sober", 60_000, 65_000, 60_000],
      ["second.webm", "account-7", "Sober", 70_000, 80_000, 0],
    ],
  );
});

test("benchmark participant sources retain real source offsets inside a middle clip", () => {
  const sources = splitParticipantTracksIntoSpeakerSources(
    [
      {
        filePath: "sober.webm",
        userId: "account-7",
        speakerId: "peer-7",
        displayNameSnapshot: "Sober",
        startMs: 0,
        endMs: 100_000,
      },
    ],
    80_000,
    30_000,
    40_000,
  );
  assert.deepEqual(
    sources.map((source) => [source.startMs, source.endMs, source.audioOffsetMs]),
    [
      [40_000, 70_000, 40_000],
      [70_000, 80_000, 70_000],
    ],
  );
});

test("recording reuses final remote playback PCM and keeps only one composite peak guard", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/recording/mixRoomAudio.ts"),
    "utf8",
  );
  const controller = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRecordingController.ts"),
    "utf8",
  );
  assert.equal(source.includes("speakerMasterVolume"), false);
  assert.equal(source.includes("memberVolumes"), false);
  assert.equal(source.includes("RemoteAudioMixer"), false);
  assert.equal(source.includes("sampleRate: 48_000"), true);
  assert.equal(source.includes("destination.channelCount = 1"), true);
  assert.equal(source.includes("overloadCompressor"), false);
  assert.equal(source.includes("samplePeakGuard"), true);
  assert.equal(source.includes("finalRemotePlaybackStream"), true);
  assert.equal(
    source.includes('remoteAudioSource: usesFinalRemotePlaybackTap ? "final_playback_pcm"'),
    true,
  );
  assert.equal(controller.includes("getRemoteAudioMixer().getFinalOutputStream()"), true);
  assert.equal(source.includes("source.segmentDestination.stream"), true);
  assert.equal(source.includes("nextRemoteStreams"), true);
  assert.equal(source.includes("stopSpeakerCapture(source)"), true);
  assert.equal(source.includes("MAX_PARTICIPANT_TRACK_SEGMENT_MS = 5 * 60_000"), true);
  assert.equal(source.includes("SPEAKER_SEGMENT_BITS_PER_SECOND = 32_000"), true);
  assert.equal(source.includes("PARTICIPANT_TRACK_BITS_PER_SECOND = 32_000"), true);
  assert.equal(source.includes("stopParticipantCapture(source).then"), true);
});
