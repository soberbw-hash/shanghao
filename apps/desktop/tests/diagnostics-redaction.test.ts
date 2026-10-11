import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeDiagnosticValue, sanitizeUrl } from "../src/main/diagnostics";

test("diagnostic URLs retain a useful endpoint without credentials or tracking fields", () => {
  assert.equal(
    sanitizeUrl("https://alice:secret@example.com/api/health?token=topsecret&id=42#session"),
    "https://example.com/api/health",
  );
  assert.equal(sanitizeUrl("file:///C:/Users/alice/recordings/voice.wav"), "[redacted-url]");
});

test("nested diagnostics and log messages redact secrets while retaining error codes", () => {
  const safe = sanitizeDiagnosticValue({
    errorCode: "E_TIMEOUT",
    profileSchemaVersion: 3,
    chatMessageCount: 12,
    chatMessages: [{ content: "private text" }],
    url: "wss://name:password@example.com/ws?session=private#fragment",
    token: "topsecret",
    message:
      "Connect https://example.com/path?authorization_code=private#here Bearer abc123 user@example.com",
    localPath: "C:\\Users\\alice\\recordings\\voice.wav",
  }) as Record<string, string>;
  assert.equal(safe.errorCode, "E_TIMEOUT");
  assert.equal(safe.profileSchemaVersion, 3);
  assert.equal(safe.chatMessageCount, 12);
  assert.equal(safe.chatMessages, "[redacted]");
  assert.equal(safe.url, "wss://example.com/ws");
  assert.equal(safe.token, "[redacted]");
  assert.match(safe.message, /https:\/\/example\.com\/path/);
  assert.doesNotMatch(JSON.stringify(safe), /topsecret|private|abc123|user@example\.com|alice/);
});

test("bounded diagnostic histories keep the newest evidence in chronological order", () => {
  const entries = Array.from({ length: 160 }, (_, index) => ({ index, token: "secret" }));
  const safe = sanitizeDiagnosticValue({
    samples: entries,
    flightRecorder: { events: entries },
    audioTimeline: entries,
    longSessionAudio: entries,
  }) as {
    samples: Array<{ index: number; token: string }>;
    flightRecorder: { events: Array<{ index: number }> };
    audioTimeline: Array<{ index: number }>;
    longSessionAudio: Array<{ index: number }>;
  };
  for (const series of [
    safe.samples,
    safe.flightRecorder.events,
    safe.audioTimeline,
    safe.longSessionAudio,
  ]) {
    assert.deepEqual(
      series.map((entry) => entry.index),
      entries.slice(-100).map((entry) => entry.index),
    );
  }
  assert.equal(safe.samples.at(-1)?.token, "[redacted]");
  assert.doesNotMatch(JSON.stringify(safe), /secret/);
  assert.equal(entries.length, 160);
});

test("export file context also bounds root timelines from the newest end", () => {
  const entries = Array.from({ length: 130 }, (_, index) => index);
  for (const filename of [
    "audio-timeline.json",
    "room-session-timeline.json",
    "ai-compute-timeline.json",
    "runtime-event-timeline.json",
  ]) {
    assert.deepEqual(sanitizeDiagnosticValue(entries, filename), entries.slice(-100));
  }
  assert.deepEqual(sanitizeDiagnosticValue(entries, "processes"), entries.slice(0, 100));
  assert.deepEqual(sanitizeDiagnosticValue(entries.slice(0, 3), "events"), [0, 1, 2]);
  assert.deepEqual(sanitizeDiagnosticValue([], "events"), []);
});
