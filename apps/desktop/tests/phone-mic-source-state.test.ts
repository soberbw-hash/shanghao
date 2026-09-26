import assert from "node:assert/strict";
import test from "node:test";

import { PhoneMicSource } from "../src/renderer/src/features/audio/phoneMicSource";

test("phone microphone keeps the actionable socket error after close", async () => {
  const originalWindow = globalThis.window;
  const originalSocket = globalThis.WebSocket;
  class FakeSocket {
    static OPEN = 1;
    static last?: FakeSocket;
    readyState = 0;
    onopen?: () => void;
    onerror?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() {
      FakeSocket.last = this;
    }
    close(): void {
      this.onclose?.();
    }
    send(): void {}
  }
  globalThis.window = {
    setTimeout,
    clearTimeout,
    desktopApi: { audio: { getPhoneMicHostTicket: async () => "ticket" } },
  } as unknown as Window & typeof globalThis;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const source = new PhoneMicSource();
  try {
    await source.start("wss://relay.example.com", "web");
    assert.equal(source.getState().phase, "connecting");
    const socket = FakeSocket.last;
    assert(socket);
    socket.onerror?.();
    socket.onclose?.();
    assert.equal(source.getState().status, "error");
    assert.match(source.getState().error ?? "", /HTTPS/);
  } finally {
    await source.stop();
    globalThis.window = originalWindow;
    globalThis.WebSocket = originalSocket;
  }
});

test("phone microphone reports waiting for scan after session creation", async () => {
  const originalWindow = globalThis.window;
  const originalSocket = globalThis.WebSocket;
  class FakeSocket {
    static OPEN = 1;
    static last?: FakeSocket;
    readyState = 1;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() {
      FakeSocket.last = this;
    }
    close(): void {
      this.onclose?.();
    }
    send(): void {}
  }
  globalThis.window = {
    setTimeout,
    clearTimeout,
    desktopApi: { audio: { getPhoneMicHostTicket: async () => "ticket" } },
  } as unknown as Window & typeof globalThis;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const source = new PhoneMicSource();
  try {
    await source.start("wss://relay.example.com", "web");
    const socket = FakeSocket.last;
    assert(socket);
    socket.onmessage?.({
      data: JSON.stringify({ type: "created", sessionId: "s", pairingSecret: "c" }),
    });
    assert.equal(source.getState().phase, "waitingForPhone");
    assert.match(source.getState().pairingUrl ?? "", /\/phone-mic#id=s&code=c/);
    socket.onmessage?.({ data: JSON.stringify({ type: "phone_connected" }) });
    assert.equal(source.getState().phase, "negotiating");
    socket.onmessage?.({ data: JSON.stringify({ type: "phone_disconnected" }) });
    assert.equal(source.getState().phase, "recovering");
    assert.equal(source.getState().pairingUrl, undefined);
    assert.match(source.getState().error ?? "", /原手机重连/);
    socket.onmessage?.({ data: JSON.stringify({ type: "phone_connected" }) });
    assert.equal(source.getState().phase, "negotiating");
    assert.equal(source.getState().error, undefined);
  } finally {
    await source.stop();
    globalThis.window = originalWindow;
    globalThis.WebSocket = originalSocket;
  }
});
