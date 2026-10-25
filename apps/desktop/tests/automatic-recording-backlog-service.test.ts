import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { SharedVoiceMemoryStore } from "../src/main/shared-voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fixture = async (withOrganization = false) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-backlog-worker-"));
  const wav = Buffer.alloc(44 + 32000);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  const items = ["first", "second", "third"].map((recordingId) => ({
    recordingId,
    filePath: path.join(directory, `${recordingId}.wav`),
    roomId: `room-${recordingId}`,
  }));
  await Promise.all(
    items.map((item, index) => {
      const voiced = Buffer.from(wav);
      for (let offset = 44; offset < voiced.length; offset += 2)
        voiced.writeInt16LE((index + 1) * 100, offset);
      return writeFile(item.filePath, voiced);
    }),
  );
  const store = new SharedVoiceMemoryStore(path.join(directory, "records"));
  await store.initialize();
  let enabled = true,
    active = 0,
    maxActive = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const calls: string[] = [];
  const service = new AiVoiceMemoryService(
    {
      getActiveAsrModel: () => "qwen3-asr-0.6b-force",
      getTaskCheckpoint: () => undefined,
    } as never,
    { validateInputFile: async () => {}, releaseAsr: () => {} } as never,
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async () => ({
        value: { description: "队友约好八点集合。", summary: [{ text: "队友约好八点集合。" }] },
      }),
    } as never,
    store,
    undefined,
    () => enabled,
    {
      status: async () => ({ cloudConfigured: true }),
      transcribe: async (file: string) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const audio = await readFile(file);
        const member = audio.readInt16LE(audio.indexOf(Buffer.from("data")) + 8) / 100 - 1;
        calls.push(path.basename(items[member]!.filePath));
        try {
          if (calls.length === 1) await blocked;
          return { text: "合成语音用于验证历史队列顺序。", modelName: "fixture" };
        } finally {
          active--;
        }
      },
    } as never,
    () => "cloud",
    () => withOrganization,
  );
  const waitStarted = async () => {
    for (let i = 0; i < 150 && !calls.length; i++) await pause(20);
    assert.equal(calls.length, 1);
  };
  const waitFinished = async () => {
    // This integration fixture starts real FFmpeg processes. The full Windows
    // suite can share CPU/disk with many other native fixtures; keep completion
    // bounded without assuming three transcodes always finish within 4 seconds.
    const deadline = Date.now() + 15_000;
    while (service.hasActiveTask() && Date.now() < deadline) await pause(20);
    assert.equal(service.hasActiveTask(), false);
  };
  return {
    service,
    store,
    items,
    calls,
    release,
    waitStarted,
    waitFinished,
    maxActive: () => maxActive,
    enable: (value: boolean) => {
      enabled = value;
    },
    close: async () => {
      release();
      await waitFinished();
      service.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("a saved cloud transcript recovers its consented missing summary through the real Main queue without uploading audio", async () => {
  const f = await fixture(true);
  const item = f.items[0]!;
  const record = {
    ...createEmptyVoiceMemoryRecord(item),
    phase: "ready" as const,
    taskStatus: "success" as const,
    autoOrganizeRequested: true,
    transcriptionModel: { id: "siliconflow-sensevoice-small" as const, name: "synthetic" },
    transcriptionElapsedMs: 100,
    transcript: [
      {
        id: "saved",
        recordingId: item.recordingId,
        speakerId: "one",
        startMs: 0,
        endMs: 1000,
        text: "队友约好八点集合。",
      },
    ],
  };
  try {
    await f.store.save(record);
    await f.service.queueRecordings([item], true);
    const deadline = Date.now() + 15_000;
    while (
      Date.now() < deadline &&
      (await f.store.get(item.recordingId))?.organization?.status !== "completed"
    )
      await pause(20);
    await f.waitFinished();
    const result = await f.store.get(item.recordingId);
    assert.equal(
      result?.organization?.status,
      "completed",
      JSON.stringify({
        phase: result?.phase,
        stage: result?.processingStage,
        error: result?.errorMessage,
        active: f.service.hasActiveTask(),
      }),
    );
    assert.equal(result?.summary[0]?.text, "队友约好八点集合。");
    assert.deepEqual(
      result?.transcript.map(({ words: _words, ...row }) => row),
      record.transcript,
    );
    assert.deepEqual(f.calls, []);
  } finally {
    await f.close();
  }
});

test("historical recordings acknowledge queued states, run one at a time, and a queued item can be paused", async () => {
  const f = await fixture();
  try {
    await f.service.queueRecordings(f.items, false);
    await f.waitStarted();
    assert.equal((await f.store.get("second"))?.taskStatus, "pending");
    await f.service.queueRecordings(f.items, false);
    assert.equal(f.calls.length, 1, "rescan must not restart the active recording");
    await f.service.pause("second");
    assert.equal((await f.store.get("second"))?.phase, "paused");
    f.release();
    await f.waitFinished();
    assert.deepEqual(f.calls, ["first.wav", "third.wav"]);
    assert.equal(f.maxActive(), 1);
    assert.equal((await f.store.get("third"))?.roomId, "room-third");
  } finally {
    await f.close();
  }
});

test("turning automation off parks the remaining queue and enabling it resumes only unfinished recordings", async () => {
  const f = await fixture();
  try {
    await f.service.queueRecordings(f.items, false);
    await f.waitStarted();
    f.enable(false);
    f.release();
    await f.waitFinished();
    assert.equal(f.calls.length, 1);
    assert.equal(
      (await f.store.get("third"))?.errorMessage,
      "deferred:automatic_transcription_disabled",
    );
    f.enable(true);
    await f.service.queueRecordings(f.items, false);
    await f.waitFinished();
    assert.deepEqual(f.calls, ["first.wav", "second.wav", "third.wav"]);
    assert.equal(f.maxActive(), 1);
  } finally {
    await f.close();
  }
});
