import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import type { SignalingEventPayload } from "@private-voice/shared";
import { WebSocketServer } from "ws";

import { SignalingClientBridge } from "../src/main/signaling-client";

test("a stale signaling session cannot close or receive events from the active session", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);

  const bridge = new SignalingClientBridge(async () => undefined);
  const events: SignalingEventPayload[] = [];
  bridge.on("event", (payload: SignalingEventPayload) => events.push(payload));

  try {
    const url = `ws://127.0.0.1:${address.port}`;
    await bridge.connect(url, "session-one");
    await bridge.connect(url, "session-two");

    assert.equal(events.at(-1)?.type, "open");
    assert.equal(events.at(-1)?.sessionId, "session-two");

    await bridge.close("session-one");
    await bridge.send('{"type":"heartbeat"}', "session-two");
    await assert.rejects(
      bridge.send('{"type":"heartbeat"}', "session-one"),
      /signaling_session_superseded/,
    );

    const activeSessionEvents = events.filter((event) => event.sessionId === "session-two");
    assert.equal(
      activeSessionEvents.some((event) => event.type === "close"),
      false,
    );
  } finally {
    await bridge.close("session-two");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
