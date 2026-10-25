import assert from "node:assert/strict";
import test from "node:test";
import type { OrganizationRetryState } from "@private-voice/shared";
import { runOrganizationWithRetry, resetOrganizationRetry } from "../src/main/organization-retry";
import { VoiceMemoryOrganizer } from "../src/main/voice-memory-organizer";
import type { VoiceMemoryRecord } from "@private-voice/shared";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";

test("summary reduction does not resend a provider content refusal", async () => {
  let calls = 0;
  let state: OrganizationRetryState | undefined;
  await assert.rejects(
    runOrganizationWithRetry(
      undefined,
      async (next) => {
        state = next;
      },
      async () => {
        calls++;
        throw Error("custom_ai_content_rejected");
      },
      new AbortController().signal,
    ),
    /custom_ai_content_rejected/,
  );
  assert.equal(calls, 1);
  assert.equal(state?.attempts, 1);
});

test("real organizer preserves the transcript and stops after one content refusal", async () => {
  let record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "synthetic", filePath: "synthetic.wav" }),
    phase: "ready",
    transcript: [
      {
        id: "local",
        recordingId: "synthetic",
        startMs: 1000,
        endMs: 4000,
        text: "仅用于测试整理失败时的原稿保留。",
        speakerId: "member",
        confidence: "high",
      },
    ],
  };
  record.transcript[0]!.words = [
    { id: "local", startMs: 1000, endMs: 4000, text: "仅用于测试整理失败时的原稿保留。" },
  ];
  const original = JSON.stringify(record.transcript);
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      organizerProvider: () => "custom",
      generateJsonWithMetrics: async () => {
        calls++;
        throw Error("custom_ai_content_rejected");
      },
    } as never,
    async (next) => (record = next),
  );
  await assert.rejects(
    organizer.organize(record, false, new AbortController().signal),
    /custom_ai_content_rejected/,
  );
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(record.transcript), original);
  assert.equal(record.organization?.chunks[0]?.attempts, 1);
  assert.equal(record.errorMessage, "organize_failed:custom_ai_content_rejected");
});

test("real organizer chunk loop persists failure budget across organizer restarts", async () => {
  let record = {
    schemaVersion: 1,
    recordingId: "retry-test",
    filePath: "test.m4a",
    phase: "ready",
    progress: 100,
    createdAt: "2026-09-07",
    updatedAt: "2026-09-07",
    speakers: [],
    chapters: [],
    highlights: [],
    summary: [],
    markerTitles: [],
    timeline: [],
    transcript: [
      {
        id: "segment",
        recordingId: "retry-test",
        startMs: 0,
        endMs: 5000,
        speakerId: "one",
        text: "今天一起打游戏，先等一下队友。",
        confidence: "high",
      },
    ],
  } as VoiceMemoryRecord;
  let calls = 0;
  const run = async (manual: boolean) => {
    const save = async (next: VoiceMemoryRecord) => {
      record = structuredClone(next);
      return record;
    };
    const gateway = {
      usesLocalOrganizer: () => true,
      generateJsonWithMetrics: async () => {
        calls++;
        throw new Error("broken_runtime");
      },
    };
    await assert.rejects(
      new VoiceMemoryOrganizer(gateway as never, save).organize(
        record,
        manual,
        new AbortController().signal,
      ),
    );
  };
  for (let i = 0; i < 3; i++) await run(false);
  assert.equal(calls, 6);
  assert.equal(record.organization?.chunks[0]?.status, "unrecoverable");
  await run(false);
  assert.equal(calls, 6);
  await run(true);
  assert.equal(calls, 8);
  assert.equal(record.organization?.chunks[0]?.attempts, 2);
});

test("organization budgets persist across runs and only explicit reset unlocks exhausted work", async () => {
  let state: OrganizationRetryState | undefined;
  let calls = 0;
  const save = async (next: OrganizationRetryState) => {
    state = JSON.parse(JSON.stringify(next));
  };
  const fail = async () => {
    calls++;
    throw new Error("deterministic_failure");
  };
  for (let run = 1; run <= 3; run++) {
    await assert.rejects(runOrganizationWithRetry(state, save, fail, new AbortController().signal));
    assert.equal(calls, run * 2);
    assert.equal(state?.attempts, run * 2);
    assert.equal(state?.status, run === 3 ? "unrecoverable" : "failed");
  }
  await assert.rejects(
    runOrganizationWithRetry(state, save, fail, new AbortController().signal),
    /retry_exhausted/,
  );
  assert.equal(calls, 6);
  state = resetOrganizationRetry(state!);
  assert.equal(
    await runOrganizationWithRetry(state, save, async () => "ok", new AbortController().signal),
    "ok",
  );
  assert.equal(state?.attempts, 1);
  assert.equal(state?.status, "completed");
});

test("legacy failed state observes lifetime cap and abort before request consumes nothing", async () => {
  let calls = 0;
  let state: OrganizationRetryState = { attempts: 6, status: "failed" };
  const save = async (next: OrganizationRetryState) => {
    state = next;
  };
  await assert.rejects(
    runOrganizationWithRetry(state, save, async () => calls++, new AbortController().signal),
  );
  assert.equal(state.status, "unrecoverable");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runOrganizationWithRetry(undefined, save, async () => calls++, controller.signal),
    /paused/,
  );
  assert.equal(calls, 0);
});
