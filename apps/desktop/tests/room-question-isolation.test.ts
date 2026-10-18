import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  readQuestionHistory,
  rememberQuestion,
} from "../src/renderer/src/features/room/roomQuestionHistory";
import { answerGlobalVoiceQuestion } from "../src/main/voice-memory-global-question";

test("room question history never adopts unscoped legacy data or another permanent room", () => {
  const storage = new Map<string, string>([
    ["shanghao:room-question-history:v1", "private legacy data"],
  ]);
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });
  try {
    assert.deepEqual(readQuestionHistory("room-a"), []);
    const answer = {
      text: "Only room A",
      sources: [{ startMs: 12, segmentId: "a", quote: "A", filePath: "A.m4a" }],
    };
    rememberQuestion("room-a", [], "private A question", answer);
    rememberQuestion("room-b", [], "B question", { text: "B", sources: [] });
    assert.equal(readQuestionHistory("room-a")[0]?.answer.sources[0]?.filePath, "A.m4a");
    assert.equal(readQuestionHistory("room-b")[0]?.question, "B question");
    assert.deepEqual(readQuestionHistory("room-c"), []);
    assert.equal(storage.get("shanghao:room-question-history:v1"), "private legacy data");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("questions queued in a previous room are rejected before searching or contacting AI", async () => {
  await assert.rejects(
    answerGlobalVoiceQuestion(
      { question: "old room secret", roomId: "room-a" },
      {
        questionRoomId: () => "room-b",
        generateJson: async () => {
          throw Error("must not call AI");
        },
      },
      {
        related: () => {
          throw Error("must not search");
        },
      },
      (operation) => operation(new AbortController().signal),
    ),
    /ai_question_room_changed/,
  );
});

test("a delayed answer from a previous room is never returned after switching", async () => {
  let roomId = "room-a";
  await assert.rejects(
    answerGlobalVoiceQuestion(
      { question: "A question", roomId },
      {
        questionRoomId: () => roomId,
        generateJson: async <T>() => {
          roomId = "room-b";
          return { text: "A private result", sources: [] } as T;
        },
      },
      { related: () => [] },
      (operation) => operation(new AbortController().signal),
    ),
    /ai_question_room_changed/,
  );
});

test("room switch remounts private assistant state and sends the originating room through IPC", () => {
  const page = readFileSync("src/renderer/src/pages/RoomPage.tsx", "utf8");
  assert.match(page, /<RoomChatPanel\s+key=\{room\.roomId\}/);
  assert.match(page, /<RoomAskDialog\s+key=\{room\.roomId\}\s+roomId=\{room\.roomId\}/);
  const dialog = readFileSync("src/renderer/src/components/room/RoomAskDialog.tsx", "utf8");
  assert.match(dialog, /askMemory\(\{ question: value, roomId \}\)/);
  assert.doesNotMatch(dialog, /room-question-history:v1/);
});
