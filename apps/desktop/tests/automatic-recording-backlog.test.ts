import assert from "node:assert/strict";
import test from "node:test";
import {
  createAutomaticRecordingBacklog,
  queueUntranscribedRecordings,
} from "../src/main/automatic-recording-backlog";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import type { VoiceMemoryRecord, VoiceMemoryProcessRequest } from "@private-voice/shared";

test("newly ready baseline assistance backfills completed cloud text without discarding it", async () => {
  const item = { recordingId: "cloud-assist", filePath: "synthetic.wav" };
  const record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord(item),
    phase: "ready",
    taskStatus: "success",
    autoOrganizeRequested: true,
    transcriptionModel: { id: "siliconflow-sensevoice-small", name: "cloud" },
    transcriptionElapsedMs: 100,
    transcript: [
      {
        id: "s",
        recordingId: item.recordingId,
        speakerId: "one",
        text: "用于恢复本地校对的合成内容",
        startMs: 0,
        endMs: 1000,
      },
    ],
    transcriptionAssist: {
      status: "unavailable",
      cloudModelId: "siliconflow-sensevoice-small",
      localModelId: "qwen3-asr-0.6b-force",
    },
  };
  const starts: VoiceMemoryProcessRequest[] = [];
  await queueUntranscribedRecordings([item], true, {
    enabled: () => true,
    get: async () => record,
    pending: () => false,
    reconcile: async () => {},
    assistModel: () => ({ id: "qwen3-asr-0.6b-force", ready: true }),
    start: async (request) => {
      starts.push(request);
    },
  });
  assert.equal(starts.length, 1);
  assert.equal(starts[0]!.transcribe, true);
  assert.notEqual(starts[0]!.restartTranscription, true);
  assert.equal(record.transcript.length, 1);
});

test("automatic followups reuse the catalog and only rescan after a real refresh", async () => {
  let reads = 0,
    queues = 0;
  const backlog = createAutomaticRecordingBacklog({
    settings: () => ({
      isAiAutoTranscribeEnabled: true,
      isAiAutoOrganizeEnabled: true,
      recordingLibraryQuotaGb: 20,
    }),
    read: async () => {
      reads++;
      return { items: [] } as never;
    },
    queue: async () => {
      queues++;
    },
    onError: () => assert.fail("unexpected failure"),
  });
  backlog.initialize();
  await backlog.settled();
  backlog.refreshCached();
  await backlog.settled();
  assert.equal(reads, 1);
  assert.equal(queues, 2);
  backlog.refresh();
  await backlog.settled();
  assert.equal(reads, 2);
});

test("an existing summary does not hide a transient fusion failure from the background queue", async () => {
  const record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "fusion-retry", filePath: "synthetic.wav" }),
    phase: "ready",
    taskStatus: "success",
    autoOrganizeRequested: true,
    organizedAt: new Date().toISOString(),
    transcriptionModel: { id: "siliconflow-sensevoice-small", name: "fixture" },
    transcriptionElapsedMs: 10,
    transcript: [
      {
        id: "s",
        recordingId: "fusion-retry",
        speakerId: "s",
        text: "合成夹具",
        startMs: 0,
        endMs: 1000,
      },
    ],
    transcriptionFusion: {
      status: "failed",
      errorCode: "cloud_asr_network_error",
      sourceSignature: "fixture",
      completedBatches: 0,
      totalBatches: 1,
      speakers: [],
      transcript: [],
    },
  };
  const started: VoiceMemoryProcessRequest[] = [];
  await queueUntranscribedRecordings(
    [{ recordingId: record.recordingId, filePath: record.filePath }],
    true,
    {
      enabled: () => true,
      get: async () => record,
      pending: () => false,
      reconcile: async () => {},
      start: async (request) => {
        started.push(request);
      },
    },
  );
  assert.equal(started.length, 1);
  assert.equal(started[0]?.transcribe, false);
  assert.equal(started[0]?.organize, true);
});

test("partial cloud failures resume from saved parts instead of being skipped as completed text", async () => {
  const item = { recordingId: "partial-cloud", filePath: "partial.wav" };
  const partial: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord(item),
    phase: "error",
    taskStatus: "failed",
    errorMessage: "cloud_asr_http_500",
    transcriptionModel: { id: "siliconflow-sensevoice-small", name: "cloud" },
    transcript: [
      {
        id: "s",
        recordingId: item.recordingId,
        speakerId: "one",
        text: "已保留的原句",
        startMs: 0,
        endMs: 1000,
      },
    ],
  };
  const starts: VoiceMemoryProcessRequest[] = [];
  for (const current of [
    partial,
    { ...partial, phase: "paused" as const, errorMessage: undefined },
    { ...partial, errorMessage: "cloud_asr_http_401" },
  ]) {
    await queueUntranscribedRecordings([item], true, {
      enabled: () => true,
      get: async () => current,
      pending: () => false,
      reconcile: async () => {},
      start: async (request) => {
        starts.push(request);
      },
    });
  }
  assert.equal(starts.length, 1);
  assert.equal(starts[0]?.transcribe, true);
  assert.notEqual(starts[0]?.restartTranscription, true);
  assert.equal(starts[0]?.manual, undefined);
});

test("empty terminal results do not get automatically uploaded again on every queue refresh", async () => {
  let starts = 0;
  for (const errorMessage of ["no_reliable_speech", "cloud_asr_unusable_transcript"])
    await queueUntranscribedRecordings(
      [{ recordingId: "empty", filePath: "synthetic.wav" }],
      true,
      {
        enabled: () => true,
        pending: () => false,
        reconcile: async () => {},
        get: async () => ({
          ...createEmptyVoiceMemoryRecord({ recordingId: "empty", filePath: "synthetic.wav" }),
          phase: "error",
          errorMessage,
        }),
        start: async () => {
          starts++;
        },
      },
    );
  assert.equal(starts, 0);
});

test("saved transcripts with prior consent recover missing postprocessing without ASR or batch regeneration of old summaries", async () => {
  const item = { recordingId: "saved", filePath: "saved.wav" };
  const record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord(item),
    phase: "ready",
    taskStatus: "success",
    autoOrganizeRequested: true,
    transcriptionModel: { id: "siliconflow-sensevoice-small", name: "cloud" },
    transcriptionElapsedMs: 100,
    transcript: [
      {
        id: "s",
        recordingId: "saved",
        text: "阿甲说我绝对不送。",
        speakerId: "one",
        startMs: 0,
        endMs: 1000,
      },
    ],
  };
  const started: VoiceMemoryProcessRequest[] = [];
  for (const current of [
    record,
    { ...record, autoOrganizeRequested: false },
    { ...record, phase: "paused" as const },
    { ...record, summary: [{ text: "朋友间游戏聊天开黑。" }] },
  ]) {
    await queueUntranscribedRecordings([item], true, {
      enabled: () => true,
      get: async () => current,
      pending: () => false,
      reconcile: async () => {},
      start: async (request) => {
        started.push(request);
      },
    });
  }
  assert.equal(started.length, 1);
  assert.equal(started[0]?.transcribe, false);
  assert.equal(started[0]?.organize, true);
});

test("empty failures respect persisted recovery deadlines and manual pauses", async () => {
  const item = { recordingId: "empty", filePath: "synthetic.wav" };
  const base = {
    ...createEmptyVoiceMemoryRecord(item),
    phase: "error" as const,
    errorMessage: "cloud_asr_http_500",
  };
  const starts: VoiceMemoryProcessRequest[] = [];
  for (const current of [
    { ...base, remoteTranscriptionRetry: { attempts: 2, nextAttemptAt: Date.now() + 60000 } },
    {
      ...base,
      phase: "paused" as const,
      errorMessage: "deferred:cloud_asr_http_500",
      remoteTranscriptionRetry: { attempts: 1, nextAttemptAt: Date.now() + 60000 },
    },
    { ...base, phase: "paused" as const, errorMessage: undefined },
  ])
    await queueUntranscribedRecordings([item], true, {
      enabled: () => true,
      get: async () => current,
      pending: () => false,
      reconcile: async () => {},
      start: async (request) => {
        starts.push(request);
      },
    });
  assert.equal(starts.length, 0);
});

test("one historical scan admits at most one missing consented summary", async () => {
  const items = ["one", "two", "three"].map((recordingId) => ({
    recordingId,
    filePath: `${recordingId}.wav`,
  }));
  const started: VoiceMemoryProcessRequest[] = [];
  await queueUntranscribedRecordings(items, true, {
    enabled: () => true,
    pending: () => false,
    reconcile: async () => {},
    get: async (id) => ({
      ...createEmptyVoiceMemoryRecord(items.find((item) => item.recordingId === id)!),
      phase: "ready",
      taskStatus: "success",
      autoOrganizeRequested: true,
      transcriptionModel: { id: "siliconflow-sensevoice-small", name: "fixture" },
      transcriptionElapsedMs: 10,
      transcript: [
        { id: "s", recordingId: id, speakerId: "one", text: "八点集合。", startMs: 0, endMs: 1000 },
      ],
    }),
    start: async (request) => {
      started.push(request);
    },
  });
  assert.equal(started.length, 1);
  assert.equal(started[0]?.transcribe, false);
});

test("historical queue keeps room identity and skips completed text, manual pauses and active jobs", async () => {
  const items = ["new", "text", "paused", "active", "bad", "next", "empty-ready"].map((id) => ({
    recordingId: id,
    filePath: `${id}.wav`,
    roomId: `room-${id}`,
    fileSize: 1,
  }));
  const record = (id: string) =>
    createEmptyVoiceMemoryRecord(items.find((item) => item.recordingId === id)!);
  const records = new Map<string, VoiceMemoryRecord>([
    [
      "text",
      {
        ...record("text"),
        transcript: [
          { id: "s", recordingId: "text", text: "保留", startMs: 0, endMs: 10, speakerId: "one" },
        ],
      },
    ],
    ["paused", { ...record("paused"), phase: "paused" }],
    ["next", { ...record("next"), roomId: "private-original" }],
    ["empty-ready", { ...record("empty-ready"), phase: "ready", taskStatus: "success" }],
  ]);
  const started: VoiceMemoryProcessRequest[] = [];
  let errors = 0;
  let reconciled = 0;
  await queueUntranscribedRecordings(items, true, {
    enabled: () => true,
    get: async (id) => {
      if (id === "bad") throw Error("unreadable");
      return records.get(id);
    },
    pending: (id) => id === "active",
    reconcile: async () => {
      reconciled++;
    },
    start: async (request) => {
      started.push(request);
    },
    onError: () => errors++,
  });
  assert.deepEqual(
    started.map((item) => item.recordingId),
    ["new", "next", "empty-ready"],
  );
  assert.deepEqual(
    started.map((item) => item.roomId),
    ["room-new", "private-original", "room-empty-ready"],
  );
  assert.ok(
    started.every((item) => item.organize === true && !item.manual && !item.restartTranscription),
  );
  assert.equal(errors, 1);
  assert.equal(reconciled, 0, "completed and stable recording metadata must remain untouched");
});

test("switching automatic transcription off stops historical admission immediately", async () => {
  let enabled = true;
  let started = 0;
  await queueUntranscribedRecordings([{ filePath: "a" }, { filePath: "b" }], false, {
    enabled: () => enabled,
    get: async () => undefined,
    pending: () => false,
    reconcile: async () => {},
    start: async () => {
      started++;
      enabled = false;
    },
  });
  assert.equal(started, 1);
});

test("startup scan is deferred until initialization, coalesced, and discards a changed recording directory", async () => {
  let settings = {
    isAiAutoTranscribeEnabled: true,
    recordingSaveDirectory: "A",
    isAiAutoOrganizeEnabled: false,
    recordingLibraryQuotaGb: 20,
  };
  let scans = 0;
  let release!: () => void;
  const queued: string[] = [];
  const backlog = createAutomaticRecordingBacklog({
    settings: () => settings,
    read: async (config) => {
      scans++;
      if (scans === 1) await new Promise<void>((resolve) => (release = resolve));
      return { items: [{ filePath: config.recordingSaveDirectory! }] } as never;
    },
    queue: async (items) => {
      queued.push(items[0]!.filePath);
    },
    onError: () => assert.fail("unexpected error"),
  });
  backlog.refresh();
  assert.equal(scans, 0);
  backlog.initialize();
  await Promise.resolve();
  settings = { ...settings, recordingSaveDirectory: "B" };
  backlog.refresh();
  backlog.refresh();
  release();
  await backlog.settled();
  assert.deepEqual(queued, ["B"]);
  assert.equal(scans, 2);
  settings = { ...settings, isAiAutoTranscribeEnabled: false };
  backlog.refresh();
  await backlog.settled();
  assert.equal(scans, 2);
});
