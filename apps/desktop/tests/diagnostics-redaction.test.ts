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
