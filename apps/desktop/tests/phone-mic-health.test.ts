import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { readPhoneMicHealth } from "../../../packages/signaling/src/phone-mic-health";

test("phone microphone health reports relay readiness without session identities", async () => {
  const relay = createServer((_request, response) => response.writeHead(200).end("ok"));
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  assert(address && typeof address !== "string");
  try {
    const health = await readPhoneMicHealth({
      relayPort: address.port,
      activeSessions: 2,
      startedAt: Date.now() - 3_000,
      version: "3.2.0-test",
    });
    assert.equal(health.status, "ok");
    assert.equal(health.activeSessions, 2);
    assert(health.uptimeSeconds >= 3);
    assert.equal(JSON.stringify(health).includes("sessionId"), false);
  } finally {
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  }
});

test("phone microphone health degrades when account relay is absent", async () => {
  const relay = createServer((_request, response) => response.writeHead(503).end());
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  assert(address && typeof address !== "string");
  try {
    const health = await readPhoneMicHealth({
      relayPort: address.port,
      activeSessions: 0,
      startedAt: Date.now(),
      version: "3.2.0-test",
    });
    assert.equal(health.status, "degraded");
    assert.equal(health.relayReady, false);
  } finally {
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  }
});
