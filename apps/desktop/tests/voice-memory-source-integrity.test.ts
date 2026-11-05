import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyCompletedSources, verifySource } from "../src/main/voice-memory-source-integrity";
import type { VoiceMemoryRecord, VoiceMemoryTranscriptionUnit } from "@private-voice/shared";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import {
  saveRecordingSpeakerSegment,
  finalizeRecordingSpeakerSegments,
} from "../src/main/recording-speaker-segments";

test("resuming a unit detects changed or missing source without exposing its path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-source-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "source.webm");
  await writeFile(filePath, Buffer.from([1, 2, 3]));
  const source = {
    filePath,
    speakerId: "a",
    accountIdentity: "a",
    displayNameSnapshot: "A",
    startMs: 0,
    endMs: 1000,
    audioOffsetMs: 0,
  };
  const fingerprint = await verifySource(source);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(await verifySource(source, fingerprint), fingerprint);
  await assert.rejects(
    verifySource({ ...source, accountIdentity: "other" }, fingerprint),
    /transcription_source_changed/,
  );
  const unit = {
    status: "completed",
    sourceFingerprint: fingerprint,
  } as VoiceMemoryTranscriptionUnit;
  await verifyCompletedSources([source], [unit]);
  await assert.rejects(verifyCompletedSources([], [unit]), /transcription_source_missing/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    verifyCompletedSources([source], [unit], controller.signal),
    /ai_task_paused/,
  );
  await assert.rejects(
    verifySource({ ...source, audioOffsetMs: 1 }, fingerprint),
    /transcription_source_changed/,
  );
  await writeFile(filePath, Buffer.from([1, 2, 3, 4]));
  await assert.rejects(verifyCompletedSources([source], [unit]), /transcription_source_changed/);
  await assert.rejects(verifySource(source, fingerprint), /transcription_source_changed/);
  await rm(filePath);
  await assert.rejects(verifySource(source, fingerprint), (error: unknown) => {
    assert.equal((error as Error).message, "transcription_source_missing");
    assert.equal((error as Error).message.includes(filePath), false);
    return true;
  });
});

test("source validation rejects a recording reached through a parent junction", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-source-junction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "target");
  const alias = path.join(root, "alias");
  await mkdir(target);
  await writeFile(path.join(target, "source.webm"), Buffer.from([1, 2, 3]));
  await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    verifySource({
      filePath: path.join(alias, "source.webm"),
      speakerId: "a",
      accountIdentity: "a",
      displayNameSnapshot: "A",
      startMs: 0,
      endMs: 1000,
      audioOffsetMs: 0,
    }),
    /transcription_source_invalid/,
  );
});

test("real local transcription pipeline refuses a source changed while inference is running", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-source-pipeline-"));
  const priorAppData = process.env.APPDATA;
  process.env.APPDATA = root;
  t.after(async () => {
    if (priorAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = priorAppData;
    await rm(root, { recursive: true, force: true });
  });
  const wave = Buffer.alloc(44 + 32000);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16000, 24);
  wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(wave.length - 44, 40);
  const filePath = path.join(root, "mixed.wav");
  await writeFile(filePath, wave);
  const saved = await saveRecordingSpeakerSegment({
    sessionId: "session",
    buffer: Uint8Array.from([1, 2]).buffer,
    sourceMimeType: "audio/webm",
    speakerId: "speaker",
    userId: "member",
    roomId: "room-a",
    displayNameSnapshot: "A",
    startMs: 0,
    endMs: 1000,
  });
  assert.ok(saved.ok);
  await finalizeRecordingSpeakerSegments({
    sessionId: "session",
    recordingId: "record",
    recordingFilePath: filePath,
  });
  const store = new VoiceMemoryStore(path.join(root, "memory"));
  await store.initialize();
  const record = await store.save(
    createEmptyVoiceMemoryRecord({ recordingId: "record", filePath, roomId: "room-a" }),
  );
  let calls = 0;
  let sourcePath = "";
  let changeDuringInference = true;
  const service = new AiVoiceMemoryService(
    {
      getActiveAsrModel: () => "qwen3-asr-0.6b-force",
      getTaskCheckpoint: () => undefined,
      canRunTask: () => ({ runnable: true, requiredModel: "qwen3-asr-0.6b-force" }),
      clearTaskCheckpoint: async () => undefined,
      saveTaskCheckpoint: async () => undefined,
    } as never,
    {
      status: async () => ({ asr: { modelName: "fixture", asrInputFormat: "wav" } }),
      transcribeChunk: async (options: { filePath: string }) => {
        calls++;
        sourcePath = options.filePath;
        if (changeDuringInference) await writeFile(options.filePath, Buffer.from([1, 2, 3]));
        return {
          segments: [
            {
              id: "fixture",
              recordingId: "record",
              speakerId: "ignored",
              startMs: 100,
              endMs: 500,
              text: "测试内容",
            },
          ],
          rawText: "测试内容",
          commonVad: {
            hasSpeech: true,
            speechDurationMs: 500,
            silenceDurationMs: 500,
            activeFrameRatio: 0.5,
            peak: 0.1,
          },
          outputStatus: "normal",
          anomalyTypes: [],
          anomalyReasons: [],
          timing: { conversionTimeMs: 0, totalTimeMs: 0 },
        };
      },
    } as never,
    {} as never,
    store,
  );
  t.after(() => service.stop());
  const core = service as unknown as {
    transcribeCore: (
      record: VoiceMemoryRecord,
      manual: boolean,
      signal: AbortSignal,
    ) => Promise<VoiceMemoryRecord>;
  };
  await assert.rejects(
    core.transcribeCore(record, true, new AbortController().signal),
    /transcription_source_changed/,
  );
  assert.equal(calls, 1);
  assert.deepEqual((await store.get(record.recordingId))?.transcript, []);
  assert.deepEqual(await readFile(filePath), wave);
  await writeFile(sourcePath, Buffer.from([1, 2]));
  changeDuringInference = false;
  const completed = await core.transcribeCore(
    (await store.get(record.recordingId))!,
    true,
    new AbortController().signal,
  );
  assert.match(completed.transcriptionUnits?.[0]?.sourceFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.equal(completed.transcript[0]?.text, "测试内容");
  await writeFile(sourcePath, Buffer.from([1, 2, 3, 4]));
  await assert.rejects(
    core.transcribeCore(completed, true, new AbortController().signal),
    /transcription_source_changed/,
  );
  assert.equal(calls, 2, "resume must reject before running ASR on replaced audio");
  assert.equal((await store.get(record.recordingId))?.transcript[0]?.text, "测试内容");
});
