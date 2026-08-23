import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";

import {
  bindTranscriptToKnownSpeaker,
  mergeSpeakerTranscript,
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

test("recording graph stays independent from playback gain and uses mono 48 kHz safety stages", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/recording/mixRoomAudio.ts"),
    "utf8",
  );
  assert.equal(source.includes("speakerMasterVolume"), false);
  assert.equal(source.includes("memberVolumes"), false);
  assert.equal(source.includes("RemoteAudioMixer"), false);
  assert.equal(source.includes("sampleRate: 48_000"), true);
  assert.equal(source.includes("destination.channelCount = 1"), true);
  assert.equal(source.includes("overloadCompressor"), true);
  assert.equal(source.includes("samplePeakGuard"), true);
  assert.equal(source.includes("source.segmentDestination.stream"), true);
  assert.equal(source.includes("nextRemoteStreams"), true);
  assert.equal(source.includes("stopSpeakerCapture(source)"), true);
});
