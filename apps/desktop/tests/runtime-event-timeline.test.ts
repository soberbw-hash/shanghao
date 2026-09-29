import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeEventTimeline } from "../src/main/runtime-event-timeline";

const now = Date.parse("2026-09-28T08:00:00.000Z");

test("runtime timeline merges room, audio and AI events in time order", () => {
  const result = buildRuntimeEventTimeline(
    {
      room: {
        generation: 2,
        capacity: 120,
        retentionMs: 600_000,
        droppedEvents: 0,
        events: [{ at: new Date(now - 3_000).toISOString(), generation: 2, event: "connected" }],
      },
      audio: [
        {
          time: new Date(now - 2_000).toISOString(),
          event: "peer_audio_silent_timeout",
          peerId: "peer-a",
          reason: "relay_no_audio_received",
          audioStreamEpoch: 3,
          fromPath: "webrtc",
          toPath: "relay",
          queueDurationMs: 180.4,
          droppedChunks: 2,
        },
      ],
      ai: [
        {
          id: 4,
          at: now - 1_000,
          kind: "transcription",
          manualRequest: false,
          phase: "stopping",
          reason: "realtime_pressure",
        },
      ],
    },
    now,
  );
  assert.deepEqual(
    result.events.map(({ source, event }) => `${source}:${event}`),
    ["room:connected", "audio:peer_audio_silent_timeout", "ai:stopping"],
  );
  assert.equal(result.events[0]?.generation, 2);
  assert.equal(result.events[1]?.peerId, "peer-a");
  assert.equal(result.events[1]?.audioStreamEpoch, 3);
  assert.equal(result.events[1]?.fromPath, "webrtc");
  assert.equal(result.events[1]?.toPath, "relay");
  assert.equal(result.events[1]?.queueDurationMs, 180);
  assert.equal(result.events[1]?.droppedChunks, 2);
  assert.equal(result.events[2]?.jobId, 4);
  assert.equal(result.events[2]?.aiKind, "transcription");
  assert.equal(result.events[2]?.manualRequest, false);
  assert.equal(result.omittedEvents, 0);
});

test("runtime timeline drops stale events and strips unexpected content", () => {
  const result = buildRuntimeEventTimeline(
    {
      audio: [
        {
          time: new Date(now - 100).toISOString(),
          event: "chat body secret",
          peerId: "bad peer name",
          reason: "private transcript",
        },
        {
          time: new Date(now - 100).toISOString(),
          event: "private_transcript",
          reason: "private_transcript",
        },
        {
          time: new Date(now - 200).toISOString(),
          event: "audio_path_switched",
          peerId: "bad peer name",
          reason: "private transcript",
          content: "secret message",
          audioStreamEpoch: -1,
          fromPath: "private_path",
          toPath: "unknown",
          queueDurationMs: 999_999,
          droppedChunks: "secret",
        },
        { time: new Date(now - 11 * 60_000).toISOString(), event: "expired" },
      ],
      ai: [],
    },
    now,
  );
  assert.equal(result.omittedEvents, 3);
  assert.deepEqual(result.events, [
    {
      at: new Date(now - 200).toISOString(),
      source: "audio",
      event: "audio_path_switched",
      peerId: undefined,
      audioStreamEpoch: undefined,
      fromPath: undefined,
      toPath: undefined,
      queueDurationMs: undefined,
      droppedChunks: undefined,
      reason: undefined,
    },
  ]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("runtime timeline is bounded at 512 events", () => {
  const ai = Array.from({ length: 600 }, (_, id) => ({
    id,
    at: now - 600 + id,
    kind: "summary" as const,
    manualRequest: false,
    phase: "queued" as const,
  }));
  const result = buildRuntimeEventTimeline({ ai }, now);
  assert.equal(result.events.length, 512);
  assert.equal(result.omittedEvents, 88);
  assert.equal(result.events[0]?.jobId, 88);
});

test("runtime timeline rejects unrecognized AI metadata", () => {
  const result = buildRuntimeEventTimeline(
    {
      ai: [
        {
          id: 5,
          at: now,
          kind: "private transcript" as "summary",
          manualRequest: "yes" as unknown as boolean,
          phase: "started",
          reason: "private transcript",
        },
      ],
    },
    now,
  );
  assert.equal(result.events[0]?.aiKind, undefined);
  assert.equal(result.events[0]?.manualRequest, undefined);
  assert.equal(JSON.stringify(result).includes("private transcript"), false);
});
