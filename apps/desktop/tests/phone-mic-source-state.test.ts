import assert from "node:assert/strict";
import test from "node:test";

import {
  PhoneMicSource,
  readablePhoneMicError,
  selectedPhoneMicConnection,
} from "../src/renderer/src/features/audio/phoneMicSource";

test("USB errors show the cause instead of Electron IPC details", () => {
  const message = readablePhoneMicError(
    new Error(
      "Error invoking remote method 'audio:phone-mic-usb-start': Error: 未检测到已授权的 Android USB 设备。请开启 USB 调试",
    ),
  );
  assert.equal(message.includes("Error invoking remote method"), false);
  assert.match(message, /连接 USB.*开启 USB 调试.*允许这台电脑/);
});

test("phone microphone labels only the selected ICE pair", () => {
  const report = (local: Record<string, unknown>, remote: Record<string, unknown>) =>
    new Map([
      ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "selected" }],
      [
        "selected",
        {
          id: "selected",
          type: "candidate-pair",
          localCandidateId: "local",
          remoteCandidateId: "remote",
          currentRoundTripTime: 0.018,
        },
      ],
      [
        "unused",
        {
          id: "unused",
          type: "candidate-pair",
          nominated: true,
          state: "succeeded",
          localCandidateId: "relay",
          remoteCandidateId: "remote",
        },
      ],
      ["local", { id: "local", type: "local-candidate", ...local }],
      ["remote", { id: "remote", type: "remote-candidate", ...remote }],
      ["relay", { id: "relay", type: "local-candidate", candidateType: "relay" }],
    ]) as unknown as RTCStatsReport;
  assert.deepEqual(
    selectedPhoneMicConnection(
      report(
        { candidateType: "host", address: "192.168.1.5" },
        { candidateType: "host", address: "192.168.1.9" },
      ),
    ),
    { connectionType: "lan", selectedCandidatePairId: "selected", latencyMs: 18 },
  );
  assert.equal(
    selectedPhoneMicConnection(
      report(
        { candidateType: "relay", address: "203.0.113.5" },
        { candidateType: "host", address: "192.168.1.9" },
      ),
    ).connectionType,
    "turn",
  );
  assert.equal(
    selectedPhoneMicConnection(
      report(
        { candidateType: "host", address: "example.local" },
        { candidateType: "host", address: "example.local" },
      ),
    ).connectionType,
    "p2p",
  );
});

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
