import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VoiceMemoryAnswer } from "@private-voice/shared";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { answerGlobalVoiceQuestion } from "../src/main/voice-memory-global-question";
import {
  formatRoomSourceTime,
  roomQuestionSources,
} from "../src/renderer/src/features/room/roomQuestionSource";

const source = {
  segmentId: "memory-1",
  startMs: 605_000,
  quote: "只属于当前频道",
  roomId: "room-a",
  roomName: "不应显示的频道名",
  createdAt: "2026-10-30T23:55:00+08:00",
};

test("source timestamps show audio wall-clock date across midnight, never an ambiguous offset", () => {
  assert.equal(formatRoomSourceTime(source), "2026年10月31日 00:05");
  assert.equal(formatRoomSourceTime({ ...source, createdAt: undefined }), "日期未知 · 录音 10:05");
  assert.equal(formatRoomSourceTime({ ...source, createdAt: "invalid" }), "日期未知 · 录音 10:05");
  assert.equal(
    formatRoomSourceTime({ ...source, createdAt: "2026-12-31T23:55:00+08:00" }),
    "2027年1月1日 00:05",
  );
  assert.ok(!formatRoomSourceTime(source).includes(source.roomName));
});

test("current-room sources exclude explicit foreign scope and malformed offsets", () => {
  const answer: VoiceMemoryAnswer = {
    text: "回答",
    sources: [
      source,
      { ...source, roomId: "room-b", quote: "other room" },
      { ...source, startMs: NaN },
      { ...source, startMs: -1 },
    ],
  };
  assert.deepEqual(roomQuestionSources(answer, "room-a"), [source]);
});

test("cancel during source reads retains stopped status and never contacts the provider", async () => {
  const controller = new AbortController();
  await assert.rejects(
    answerGlobalVoiceQuestion(
      { question: "约饭", roomId: "room-a" },
      {
        questionRoomId: () => "room-a",
        generateJson: async () => {
          throw Error("must not contact model");
        },
      },
      {
        related: () => [
          {
            recordingId: "a",
            filePath: "a.m4a",
            createdAt: source.createdAt,
            startMs: 0,
            title: "约饭",
            excerpt: "约饭",
            score: 1,
            kind: "transcript",
          },
        ],
        get: async () => {
          controller.abort();
          return undefined;
        },
      },
      (operation) => operation(controller.signal),
    ),
    /ai_task_paused/,
  );
});

test("real memory index isolates identical words and rechecks source ownership before model access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-question-scope-"));
  const store = new VoiceMemoryStore(directory);
  try {
    await store.initialize();
    for (const roomId of ["room-a", "room-b", undefined]) {
      const id = roomId ?? "unscoped";
      await store.save({
        ...createEmptyVoiceMemoryRecord({
          recordingId: id,
          filePath: path.join(directory, `${id}.m4a`),
          roomId,
          recordedAt: source.createdAt,
        }),
        phase: "ready",
        createdAt: "2026-11-10T12:00:00Z",
        progress: 100,
        transcript: [
          {
            id: `${id}-line`,
            recordingId: id,
            startMs: source.startMs,
            endMs: 610_000,
            text: `约饭 ${id}专属内容`,
            confidence: "high",
          },
        ],
      });
    }
    let prompt = "";
    const gateway = {
      questionRoomId: () => "room-a",
      generateJson: async <T>(request: { prompt: string }) => {
        prompt = request.prompt;
        return {
          text: "回答",
          sources: [
            {
              segmentId: "memory-1",
              startMs: 0,
              roomId: "room-b",
              createdAt: "2099-01-01",
              quote: "约饭",
            },
          ],
        } as T;
      },
    };
    const run = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
      operation(new AbortController().signal);
    const result = await answerGlobalVoiceQuestion(
      { question: "约饭", roomId: "room-a" },
      gateway,
      store,
      run,
    );
    assert.ok(prompt.includes("room-a专属内容"));
    assert.doesNotMatch(prompt, /room-b专属内容|unscoped专属内容|2026-11-10/);
    assert.equal(result.sources[0]?.roomId, "room-a");
    assert.equal(result.sources[0]?.createdAt, source.createdAt);
    assert.equal(result.sources[0]?.startMs, source.startMs);
    assert.equal(formatRoomSourceTime(result.sources[0]!), "2026年10月31日 00:05");
    // Simulate a stale/corrupt derived index claiming a foreign record as a candidate.
    const foreign = store.related("约饭", 24, "room-b");
    const guarded = await answerGlobalVoiceQuestion(
      { question: "约饭", roomId: "room-a" },
      gateway,
      { related: () => foreign, get: (id) => store.get(id) },
      run,
    );
    assert.deepEqual(guarded.sources, []);
    assert.doesNotMatch(prompt, /room-b专属内容/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
