import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "@private-voice/shared";
import { selectCharacterChatBubbles } from "../src/renderer/src/features/room/roomViewModel";
import { gameAssistantMessageId } from "../src/renderer/src/features/chat/gameAssistantMessage";

test("assistant shares do not appear beside the speaker; normal messages still do", () => {
  const now = Date.now();
  const message = {
    id: "normal",
    peerId: "user",
    content: "你好",
    createdAt: new Date(now).toISOString(),
  } as ChatMessage;
  const assistant = {
    ...message,
    id: "ai",
    content: "【回答】答案",
    clientMessageId: gameAssistantMessageId("7caa9d55-c745-4379-b5c0-aa19a317c377"),
  };
  assert.deepEqual(selectCharacterChatBubbles([assistant], [], now), []);
  assert.equal(selectCharacterChatBubbles([message, assistant], [], now)[0]?.content, "你好");
});
