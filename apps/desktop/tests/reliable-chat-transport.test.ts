import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "@private-voice/shared";
import type { ChatMessage as SignalChatMessage, ClientMessage } from "@private-voice/signaling";

test("a legacy local echo confirms a pending send even when the server advertises ACK support", async () => {
  const originalWindow = globalThis.window;
  let timerSequence = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const windowShim = {
    setTimeout: (handler: TimerHandler, timeout?: number) => {
      const id = ++timerSequence;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          if (typeof handler === "function") handler();
        }, timeout),
      );
      return id;
    },
    clearTimeout: (id: number) => {
      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      timers.delete(id);
    },
  } as unknown as Window & typeof globalThis;
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowShim });

  try {
    const { ReliableChatTransport } =
      await import("../src/renderer/src/features/chat/ReliableChatTransport");
    const submitted: ClientMessage[] = [];
    const received: ChatMessage[] = [];
    const transport = new ReliableChatTransport({
      roomId: "main",
      peerId: "local-peer",
      canSend: () => true,
      getServerBuildNumber: () => "2026.08.12.1",
      send: async (payload) => {
        submitted.push(payload);
      },
      onMessage: (message) => received.push(message),
      onHistory: () => undefined,
      onRecall: () => undefined,
    });

    const acknowledgement = transport.sendMessage("只发一次", undefined, "client-message-1");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(submitted.length, 1);

    transport.handleMessage({
      type: "chat_message",
      roomId: "main",
      id: "server-message-1",
      peerId: "local-peer",
      nickname: "Sober",
      content: "只发一次",
      createdAt: new Date().toISOString(),
    } satisfies SignalChatMessage);

    const ack = await acknowledgement;
    assert.equal(ack.clientMessageId, "client-message-1");
    assert.equal(ack.messageId, "server-message-1");
    assert.equal(received.length, 1);
    assert.equal(received[0]?.clientMessageId, "client-message-1");
    assert.equal(submitted.length, 1);
    assert.equal(timers.size, 0);
  } finally {
    for (const timer of timers.values()) clearTimeout(timer);
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
