import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { Script } from "node:vm";

import { WebSocket } from "ws";

import { PHONE_MIC_PAGE } from "../../../packages/signaling/src/phone-mic-page";
import { PhoneMicBridge } from "../../../packages/signaling/src/phone-mic-bridge";
import { SignalingServer } from "../../../packages/signaling/src/server";
import { PHONE_MIC_USB_PAGE } from "../src/main/phone-mic-usb-page";

const scriptOf = (html: string): string => html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

test("phone microphone pages contain valid JavaScript", () => {
  assert.doesNotThrow(() => new Script(scriptOf(PHONE_MIC_PAGE)));
  assert.doesNotThrow(() => new Script(scriptOf(PHONE_MIC_USB_PAGE)));
});

test("signaling server serves the mobile page without changing room health", async () => {
  const server = new SignalingServer({ roomName: "Phone mic test" });
  const port = await server.listen();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/phone-mic`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /手机麦克风/);
    const health = (await fetch(`http://127.0.0.1:${port}/health`).then((response) =>
      response.json(),
    )) as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.phoneMicSessions, 0);
    const missingToken = await fetch(`http://127.0.0.1:${port}/phone-mic/ticket`, {
      method: "POST",
    });
    assert.equal(missingToken.status, 401);
  } finally {
    await server.close();
  }
});

test("phone pairing relays only the paired session and can be recreated", async () => {
  const bridge = new PhoneMicBridge(
    () => [],
    async (token) => token === "test-account-token",
  );
  const server = createServer((request, response) => {
    void bridge.serveTicket(request, response).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  server.on("upgrade", (request, socket, head) => bridge.handleUpgrade(request, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/phone-mic/ws`;
  const getTicket = async (token: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${address.port}/phone-mic/ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  const connect = async (): Promise<WebSocket> => {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return socket;
  };
  const next = (socket: WebSocket): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      socket.once("message", (raw) =>
        resolve(JSON.parse(raw.toString()) as Record<string, unknown>),
      );
      socket.once("error", reject);
    });
  try {
    assert.equal((await getTicket("bad-token")).status, 401);
    const unauthenticated = await connect();
    const rejected = new Promise<number>((resolve) => unauthenticated.once("close", resolve));
    unauthenticated.send(JSON.stringify({ type: "create" }));
    assert.equal(await rejected, 4401);
    for (let i = 0; i < 5; i++) {
      const host = await connect();
      const createdMessage = next(host);
      const ticketResponse = await getTicket("test-account-token");
      assert.equal(ticketResponse.status, 200);
      const { ticket } = (await ticketResponse.json()) as { ticket: string };
      host.send(JSON.stringify({ type: "create", ticket }));
      const created = await createdMessage;
      assert.equal(created.type, "created");
      const replay = await connect();
      const replayClosed = new Promise<number>((resolve) => replay.once("close", resolve));
      replay.send(JSON.stringify({ type: "create", ticket }));
      assert.equal(await replayClosed, 4401);
      const wrong = await connect();
      const wrongClosed = new Promise<number>((resolve) => wrong.once("close", resolve));
      wrong.send(JSON.stringify({ type: "join", sessionId: created.sessionId, secret: "wrong" }));
      assert.equal(await wrongClosed, 4403);
      const phone = await connect();
      const joinedMessage = next(phone);
      const connectedMessage = next(host);
      phone.send(
        JSON.stringify({
          type: "join",
          sessionId: created.sessionId,
          secret: created.pairingSecret,
        }),
      );
      assert.equal((await joinedMessage).type, "joined");
      assert.equal((await connectedMessage).type, "phone_connected");
      const offerMessage = next(host);
      phone.send(JSON.stringify({ type: "offer", sdp: "test-offer" }));
      assert.deepEqual(await offerMessage, { type: "offer", sdp: "test-offer" });
      const answerMessage = next(phone);
      host.send(JSON.stringify({ type: "answer", sdp: "test-answer" }));
      assert.deepEqual(await answerMessage, { type: "answer", sdp: "test-answer" });
      const disconnectedMessage = next(host);
      phone.close();
      assert.equal((await disconnectedMessage).type, "phone_disconnected");
      const hostClosed = new Promise<void>((resolve) => host.once("close", () => resolve()));
      host.close();
      await hostClosed;
    }
    for (let attempt = 0; attempt < 20 && bridge.activeSessions > 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(bridge.activeSessions, 0);
  } finally {
    bridge.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
