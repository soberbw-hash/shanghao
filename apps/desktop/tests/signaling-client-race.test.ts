import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import type { SignalingEventPayload } from "@private-voice/shared";
import { WebSocketServer } from "ws";

import { SignalingClientBridge } from "../src/main/signaling-client";
import { isSignalingSessionSupersededError } from "../src/renderer/src/features/room/signalingSessionOwnership";

test("renderer recognizes stale signaling ownership errors without hiding other failures", () => {
  assert.equal(isSignalingSessionSupersededError(new Error("signaling_session_superseded")), true);
  assert.equal(
    isSignalingSessionSupersededError(
      "Error invoking remote method 'signaling:send': Error: signaling_session_superseded",
    ),
    true,
  );
  assert.equal(isSignalingSessionSupersededError(new Error("signaling_not_connected")), false);
});

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

test("update handoff waits for the WebSocket update close handshake", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  let resolveUpdateClose: ((value: { code: number; reason: string }) => void) | undefined;
  const updateClose = new Promise<{ code: number; reason: string }>((resolve) => {
    resolveUpdateClose = resolve;
  });
  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type?: string;
        roomId?: string;
        peerId?: string;
        reason?: string;
      };
      if (message.type === "join_channel") {
        socket.send(
          JSON.stringify({
            type: "join_ack",
            roomId: message.roomId,
            peerId: message.peerId,
            serverTime: Date.now(),
            revision: 1,
            memberCount: 1,
            sessionToken: "test-token",
          }),
        );
      }
    });
    socket.on("close", (code, reason) => {
      resolveUpdateClose?.({ code, reason: reason.toString() });
    });
  });

  const bridge = new SignalingClientBridge(async () => undefined);
  try {
    await bridge.connect(`ws://127.0.0.1:${address.port}`, "update-session");
    const joined = new Promise<void>((resolve) => {
      bridge.on("event", (event: SignalingEventPayload) => {
        if (event.type === "message" && event.data?.includes('"type":"join_ack"')) resolve();
      });
    });
    await bridge.send(
      JSON.stringify({ type: "join_channel", roomId: "main", peerId: "peer-1" }),
      "update-session",
    );
    await joined;

    assert.equal(await bridge.prepareForUpdate(), true);
    assert.deepEqual(await updateClose, { code: 4002, reason: "client_updating" });
  } finally {
    await bridge.close("update-session");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("cloud AI requests reuse the joined room socket and stay out of renderer events", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  let requestCount = 0;
  let resolveSecondRequest: (() => void) | undefined;
  let resolveCancelledRequest: ((requestId: string) => void) | undefined;
  const secondRequest = new Promise<void>((resolve) => {
    resolveSecondRequest = resolve;
  });
  const cancelledRequest = new Promise<string>((resolve) => {
    resolveCancelledRequest = resolve;
  });
  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type?: string;
        roomId?: string;
        peerId?: string;
        requestId?: string;
      };
      if (message.type === "join_channel") {
        socket.send(
          JSON.stringify({
            type: "join_ack",
            roomId: message.roomId,
            peerId: message.peerId,
            serverTime: Date.now(),
            revision: 1,
            memberCount: 1,
            sessionToken: "test-token",
          }),
        );
      }
      if (message.type === "cloud_ai_request") {
        requestCount += 1;
        if (requestCount === 1) {
          socket.send(
            JSON.stringify({
              type: "cloud_ai_response",
              roomId: message.roomId,
              peerId: message.peerId,
              requestId: message.requestId,
              ok: true,
              content: '{"text":"回答","sources":[]}',
            }),
          );
        } else {
          resolveSecondRequest?.();
        }
      }
      if (message.type === "cloud_ai_cancel" && message.requestId) {
        resolveCancelledRequest?.(message.requestId);
      }
    });
  });

  const bridge = new SignalingClientBridge(async () => undefined);
  const rendererMessages: string[] = [];
  bridge.on("event", (event: SignalingEventPayload) => {
    if (event.type === "message") rendererMessages.push(event.data ?? "");
  });
  try {
    await bridge.connect(`ws://127.0.0.1:${address.port}`, "cloud-session");
    const joined = new Promise<void>((resolve) => {
      bridge.on("event", (event: SignalingEventPayload) => {
        if (event.type === "message" && event.data?.includes('"type":"join_ack"')) resolve();
      });
    });
    await bridge.send(
      JSON.stringify({ type: "join_channel", roomId: "main", peerId: "peer-1" }),
      "cloud-session",
    );
    await joined;

    const result = await bridge.requestCloudAi({
      purpose: "question",
      prompt: "今天有什么新闻？",
      useWebSearch: true,
    });

    assert.equal(result, '{"text":"回答","sources":[]}');
    assert.equal(
      rendererMessages.some((message) => message.includes("cloud_ai_response")),
      false,
    );

    const controller = new AbortController();
    const pending = bridge.requestCloudAi({
      purpose: "question",
      prompt: "停止这个问题",
      signal: controller.signal,
    });
    await secondRequest;
    controller.abort();
    await assert.rejects(pending, /ai_task_paused/);
    assert.ok(await cancelledRequest);
  } finally {
    await bridge.close("cloud-session");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
