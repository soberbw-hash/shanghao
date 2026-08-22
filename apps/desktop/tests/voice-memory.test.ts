import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AI_ASR_MODEL_NAMES,
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  hasInvalidVoiceMemoryResult,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import {
  analyzePcm16Wav,
  parseVibeVoiceOutput,
  temporaryRecordingName,
  torchAudioInstallPlan,
} from "../src/main/ai-runtime-manager";
import { buildVibeVoiceArguments } from "../src/main/vibevoice-runtime";
import {
  AiVoiceMemoryService,
  AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS,
  applySpeakingTimeline,
  canAutomaticallyTranscribeDuration,
  completedTranscriptionUnits,
  TRANSCRIPTION_CHUNK_MS,
  transcriptionModelMetadata,
} from "../src/main/ai-voice-memory-service";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import {
  advanceVoiceProcessingState,
  createVoiceProcessingState,
  targetsForVoiceProcessingMode,
} from "../src/renderer/src/features/audio/voiceProcessingState";

const record = (): VoiceMemoryRecord => ({
  schemaVersion: 1,
  recordingId: "C:\\录音\\一号房-01.m4a",
  filePath: "C:\\录音\\一号房-01.m4a",
  roomId: "main",
  roomName: "一号房",
  createdAt: "2026-08-13T12:00:00.000Z",
  updatedAt: "2026-08-13T12:00:00.000Z",
  phase: "ready",
  progress: 100,
  speakers: [{ speakerId: "Speaker 1", confidence: "pending" }],
  transcript: [
    {
      id: "s1",
      recordingId: "C:\\录音\\一号房-01.m4a",
      startMs: 1_000,
      endMs: 3_000,
      text: "周六晚上七点吃饭",
      speakerId: "Speaker 1",
      confidence: "pending",
    },
  ],
  summary: [{ text: "大家约了周六晚上七点吃饭。", sourceStartMs: 1_000 }],
  chapters: [{ id: "c1", startMs: 0, title: "约周末吃饭" }],
  highlights: [],
  markerTitles: [{ markerId: "m1", offsetMs: 1_500, title: "周六约饭" }],
  timeline: [{ id: "m1", kind: "marker", offsetMs: 1_500, title: "周六约饭" }],
});

test("VibeASR uses the sampling decoder defaults required for Chinese recordings", () => {
  const modelPath = "C:\\models\\vibevoice";
  const args = buildVibeVoiceArguments({
    modelPath,
    wavPath: "C:\\recordings\\room.wav",
    resourceMode: "low",
  });

  assert.deepEqual(args, [
    "--vae-model",
    path.join(modelPath, "vibeasr-vae-encoder-i8_s.gguf"),
    "--lm-model",
    path.join(modelPath, "vibeasr-lm-i2_s-embed-q6_k.gguf"),
    "--audio",
    "C:\\recordings\\room.wav",
    "-t",
    "4",
  ]);
  assert.equal(args.includes("--greedy"), false);
  assert.equal(args.includes("--prompt-format"), false);
});

test("Paraformer repairs torchaudio from the index matching bundled PyTorch", () => {
  assert.deepEqual(torchAudioInstallPlan("2.11.0+cu128"), {
    version: "2.11.0",
    indexUrl: "https://download.pytorch.org/whl/cu128",
  });
  assert.deepEqual(torchAudioInstallPlan("2.11.0+cpu"), {
    version: "2.11.0",
    indexUrl: "https://download.pytorch.org/whl/cpu",
  });
  assert.deepEqual(torchAudioInstallPlan("2.11.0"), { version: "2.11.0" });
  assert.throws(() => torchAudioInstallPlan("nightly"), /unsupported_torch_version/);
});

test("VibeVoice timestamps become clickable structured transcript segments", () => {
  const segments = parseVibeVoiceOutput(
    "[00:01.000 - 00:03.500] Speaker 2: 等我十分钟。",
    "recording-a",
    60_000,
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.startMs, 61_000);
  assert.equal(segments[0]?.endMs, 63_500);
  assert.equal(segments[0]?.speakerId, "Speaker 2");
});

test("VibeVoice structured JSON preserves UTF-8 Chinese and native timestamps", () => {
  const segments = parseVibeVoiceOutput(
    '\uFEFF[{"Start":0.25,"End":2.5,"Speaker":2,"Content":"我们上号打游戏，稍后开 Discord。"}]',
    "recording-json",
    10_000,
    4_000,
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.startMs, 10_250);
  assert.equal(segments[0]?.endMs, 12_500);
  assert.equal(segments[0]?.speakerId, "Speaker 2");
  assert.equal(segments[0]?.text, "我们上号打游戏，稍后开 Discord。");
});

test("BitNet plain-text output becomes readable sentence-level seek segments", () => {
  const segments = parseVibeVoiceOutput(
    "第一句话。第二句话！\n---END---",
    "recording-plain",
    120_000,
    30_000,
  );
  assert.deepEqual(
    segments.map((segment) => segment.text),
    ["第一句话。", "第二句话！"],
  );
  assert.equal(segments[0]?.startMs, 120_000);
  assert.equal(segments[1]?.endMs, 150_000);
});

test("ASR status labels and repetitive hallucinations are not saved as speech", () => {
  assert.equal(parseVibeVoiceOutput("Non-Speech", "silent", 0).length, 0);
  assert.equal(
    parseVibeVoiceOutput("[00:00.000 - 00:30.000] Speaker 1: Non-Speech", "timestamped-silent", 0)
      .length,
    0,
  );
  assert.equal(
    parseVibeVoiceOutput("na, na, na, na, na, na, na, na, na, na, na, na", "repeat", 0).length,
    0,
  );
  assert.equal(
    parseVibeVoiceOutput("I can't help it. I can't help it. I can't help it.", "repeat-phrase", 0)
      .length,
    0,
  );
  assert.equal(
    parseVibeVoiceOutput(`我不是新用户。${"对".repeat(240)}`, "repeat-chinese", 0).length,
    0,
  );
  assert.equal(parseVibeVoiceOutput("�������", "broken", 0).length, 0);
});

test("Mandarin-only ASR rejects foreign-script hallucinations", () => {
  assert.equal(parseVibeVoiceOutput("왜 넌 이냐마", "korean-hallucination", 0).length, 0);
  assert.equal(parseVibeVoiceOutput("Amor a vida.", "portuguese-hallucination", 0).length, 0);
  assert.equal(parseVibeVoiceOutput("我们上号打游戏，打开 Discord。", "mandarin", 0).length, 1);
});

test("legacy Chinese transcripts stay visible while foreign hallucinations remain blocked", () => {
  const legacy = record();
  assert.equal(hasInvalidVoiceMemoryResult(legacy), false);
  assert.equal(
    hasInvalidVoiceMemoryResult({
      ...legacy,
      transcript: legacy.transcript.map((segment) => ({ ...segment, text: "Deixa eu pesquisar." })),
      transcriptionPipelineVersion: CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
    }),
    true,
  );
});

test("a ready record with no transcript is never presented as a successful transcription", () => {
  const empty = { ...record(), transcript: [] };
  assert.equal(
    hasInvalidVoiceMemoryResult({
      ...empty,
      transcriptionPipelineVersion: CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
    }),
    true,
  );
});

const pcm16Wav = (samples: Int16Array, sampleRate = 24_000): Buffer => {
  const wav = Buffer.alloc(44 + samples.byteLength);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples.byteLength, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.byteLength, 40);
  for (let index = 0; index < samples.length; index += 1) {
    wav.writeInt16LE(samples[index] ?? 0, 44 + index * 2);
  }
  return wav;
};

test("silent PCM chunks are skipped while sustained voice-level audio is accepted", () => {
  const silence = new Int16Array(24_000);
  silence.fill(10);
  assert.equal(analyzePcm16Wav(pcm16Wav(silence)).audible, false);

  const voiced = new Int16Array(24_000);
  for (let index = 0; index < voiced.length; index += 1) {
    voiced[index] = Math.round(Math.sin(index / 8) * 2_500);
  }
  const activity = analyzePcm16Wav(pcm16Wav(voiced));
  assert.equal(activity.audible, true);
  assert.ok(activity.peak > 0.05);
});

test("Windows recording paths become safe temporary audio names", () => {
  const temporaryName = temporaryRecordingName("C:\\Users\\sober\\Documents\\上号录音\\一号房.m4a");
  assert.match(temporaryName, /^[a-f0-9]{20}$/);
  assert.equal(temporaryName.includes(":"), false);
  assert.equal(temporaryName.includes("\\"), false);
});

test("speaker observations only bind a nickname when the timeline is convincing", () => {
  const mapped = applySpeakingTimeline(record(), [
    { offsetMs: 1_200, memberId: "member-laowang", nickname: "老王" },
    { offsetMs: 1_800, memberId: "member-laowang", nickname: "老王" },
    { offsetMs: 2_400, memberId: "member-laowang", nickname: "老王" },
  ]);
  assert.equal(mapped.transcript[0]?.nickname, "老王");
  assert.equal(mapped.transcript[0]?.confidence, "high");

  const uncertain = applySpeakingTimeline(record(), [
    { offsetMs: 1_200, memberId: "one", nickname: "甲" },
    { offsetMs: 1_800, memberId: "two", nickname: "乙" },
  ]);
  assert.equal(uncertain.transcript[0]?.nickname, undefined);
});

test("transcription checkpoints update in shorter visible steps and preserve legacy progress", () => {
  assert.equal(TRANSCRIPTION_CHUNK_MS, 30_000);
  assert.equal(
    completedTranscriptionUnits({ completedUnits: 1, unitDurationMs: 10 * 60_000 }, 20),
    20,
  );
  assert.equal(completedTranscriptionUnits({ completedUnits: 3, unitDurationMs: 30_000 }, 20), 3);
});

test("voice memories retain the exact ASR model instead of following later settings", async () => {
  assert.deepEqual(
    transcriptionModelMetadata("qwen3-asr-0.6b-force", {
      modelId: "qwen3-asr-0.6b-force",
      ready: true,
      modelName: "Qwen3-ASR-0.6B",
      modelVersion: "revision-qwen-1",
    }),
    {
      id: "qwen3-asr-0.6b-force",
      name: "Qwen3-ASR-0.6B",
      version: "revision-qwen-1",
    },
  );

  const legacy = record();
  const service = new AiVoiceMemoryService(
    {
      getTaskCheckpoint: () => ({
        taskId: `transcription:${legacy.recordingId}`,
        recordingId: legacy.recordingId,
        kind: "transcription",
        completedUnits: 1,
        totalUnits: 1,
        asrModelId: "paraformer-zh",
        updatedAt: new Date().toISOString(),
      }),
    } as never,
    {} as never,
    {} as never,
    {
      get: async () => legacy,
      list: async () => [legacy],
    } as never,
  );

  assert.deepEqual((await service.get(legacy.recordingId))?.transcriptionModel, {
    id: "paraformer-zh",
    name: AI_ASR_MODEL_NAMES["paraformer-zh"],
  });
  assert.equal((await service.list())[0]?.transcriptionModel?.id, "paraformer-zh");
});

test("A/B transcription variants stay separate and can be selected without retranscribing", async () => {
  let durable = {
    ...record(),
    transcript: [],
    speakers: [],
    transcriptionModel: undefined,
    transcriptionVariants: undefined,
  } as VoiceMemoryRecord;
  const store = {
    get: async () => durable,
    save: async (value: VoiceMemoryRecord) => {
      durable = value;
      return value;
    },
  };
  const service = new AiVoiceMemoryService({} as never, {} as never, {} as never, store as never);
  const save = (
    service as unknown as { save: (value: VoiceMemoryRecord) => Promise<VoiceMemoryRecord> }
  ).save.bind(service);
  const qwenTranscript = [{ ...record().transcript[0]!, text: "千问结果" }];
  const paraformerTranscript = [{ ...record().transcript[0]!, text: "Paraformer 结果" }];

  await save({
    ...durable,
    transcript: qwenTranscript,
    speakers: record().speakers,
    transcriptionModel: {
      id: "qwen3-asr-0.6b-force",
      name: "Qwen3-ASR-0.6B + ForcedAligner",
    },
  });
  await save({
    ...durable,
    transcript: paraformerTranscript,
    speakers: record().speakers,
    transcriptionModel: { id: "paraformer-zh", name: "Paraformer 中文套件" },
  });

  assert.equal(
    durable.transcriptionVariants?.["qwen3-asr-0.6b-force"]?.transcript[0]?.text,
    "千问结果",
  );
  assert.equal(
    durable.transcriptionVariants?.["paraformer-zh"]?.transcript[0]?.text,
    "Paraformer 结果",
  );
  const selected = await service.selectTranscriptionVariant(
    durable.recordingId,
    "qwen3-asr-0.6b-force",
  );
  assert.equal(selected.transcript[0]?.text, "千问结果");
  assert.equal(
    selected.transcriptionVariants?.["paraformer-zh"]?.transcript[0]?.text,
    "Paraformer 结果",
  );
});

test("room questions expose a real cancellation signal to every text provider", async () => {
  let questionSignal: AbortSignal | undefined;
  const service = new AiVoiceMemoryService(
    {} as never,
    {} as never,
    {
      generateJson: async ({ signal }: { signal?: AbortSignal }) => {
        questionSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("ai_task_paused")), {
            once: true,
          });
        });
      },
    } as never,
    { related: () => [] } as never,
  );

  const pending = service.askMemory({ question: "现在几点？" });
  assert.equal(service.cancelQuestion(), true);
  await assert.rejects(pending, /ai_task_paused/);
  assert.equal(questionSignal?.aborted, true);
  assert.equal(service.cancelQuestion(), false);
});

test("continue transcription keeps the saved checkpoint instead of requesting a clean restart", async () => {
  const paused = {
    ...record(),
    phase: "paused" as const,
    progress: 35,
    processingStage: "asr" as const,
  };
  const service = new AiVoiceMemoryService(
    {} as never,
    {} as never,
    {} as never,
    { get: async () => paused } as never,
  );
  let request: Parameters<AiVoiceMemoryService["start"]>[0] | undefined;
  (service as unknown as { start: AiVoiceMemoryService["start"] }).start = async (next) => {
    request = next;
    return paused;
  };

  await service.resume(paused.recordingId);

  assert.equal(request?.transcribe, true);
  assert.equal(request?.restartTranscription, undefined);
  assert.equal(request?.organize, false);
});

test("pausing after saved chunks keeps the newest durable transcript instead of overwriting it", async () => {
  const initial = {
    ...record(),
    phase: "idle" as const,
    progress: 0,
    speakers: [],
    transcript: [],
    summary: [],
    chapters: [],
    markerTitles: [],
    timeline: [],
  };
  let durable = initial;
  const store = {
    get: async () => durable,
    save: async (value: VoiceMemoryRecord) => {
      durable = value;
      return value;
    },
  };
  const service = new AiVoiceMemoryService(
    {} as never,
    { validateInputFile: async () => undefined } as never,
    {} as never,
    store as never,
  );
  (service as unknown as { transcribe: () => Promise<VoiceMemoryRecord> }).transcribe =
    async () => {
      durable = {
        ...durable,
        phase: "transcribing",
        progress: 42,
        transcript: record().transcript,
        speakers: record().speakers,
      };
      throw new Error("ai_task_paused");
    };

  const result = await (
    service as unknown as {
      processNow: (request: {
        recordingId: string;
        filePath: string;
        manual: boolean;
        organize: boolean;
      }) => Promise<VoiceMemoryRecord>;
    }
  ).processNow({
    recordingId: initial.recordingId,
    filePath: initial.filePath,
    manual: true,
    organize: false,
  });

  assert.equal(result.phase, "paused");
  assert.equal(result.progress, 42);
  assert.equal(result.transcript[0]?.text, "周六晚上七点吃饭");
  assert.equal(durable.transcript[0]?.text, "周六晚上七点吃饭");
});

test("a later ASR failure keeps already saved chunks available for continuing", async () => {
  const initial = {
    ...record(),
    phase: "idle" as const,
    progress: 0,
    speakers: [],
    transcript: [],
    summary: [],
    chapters: [],
    markerTitles: [],
    timeline: [],
  };
  let durable = initial;
  const store = {
    get: async () => durable,
    save: async (value: VoiceMemoryRecord) => {
      durable = value;
      return value;
    },
  };
  const service = new AiVoiceMemoryService(
    {} as never,
    { validateInputFile: async () => undefined } as never,
    {} as never,
    store as never,
  );
  (service as unknown as { transcribe: () => Promise<VoiceMemoryRecord> }).transcribe =
    async () => {
      durable = {
        ...durable,
        phase: "transcribing",
        progress: 60,
        transcript: record().transcript,
        speakers: record().speakers,
      };
      throw new Error("asr_runtime_failed: simulated failure");
    };

  await assert.rejects(
    (
      service as unknown as {
        processNow: (request: {
          recordingId: string;
          filePath: string;
          manual: boolean;
          organize: boolean;
        }) => Promise<VoiceMemoryRecord>;
      }
    ).processNow({
      recordingId: initial.recordingId,
      filePath: initial.filePath,
      manual: true,
      organize: false,
    }),
    /asr_runtime_failed/,
  );

  assert.equal(durable.phase, "error");
  assert.equal(durable.progress, 60);
  assert.equal(durable.transcript[0]?.text, "周六晚上七点吃饭");
  assert.match(durable.errorMessage ?? "", /asr_runtime_failed/);
});

test("automatic transcription leaves recordings longer than thirty minutes for manual action", () => {
  assert.equal(canAutomaticallyTranscribeDuration(AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS), true);
  assert.equal(
    canAutomaticallyTranscribeDuration(AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS + 1),
    false,
  );
});

test("a manual transcription runs before already queued background recordings", async () => {
  const service = new AiVoiceMemoryService({} as never, {} as never, {} as never, {} as never);
  const started: string[] = [];
  let finishFirst: (() => void) | undefined;
  const firstFinished = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  (
    service as unknown as {
      processNow: (request: { recordingId: string }) => Promise<VoiceMemoryRecord>;
    }
  ).processNow = async (request) => {
    started.push(request.recordingId);
    if (request.recordingId === "background-1") await firstFinished;
    return { ...record(), recordingId: request.recordingId, filePath: request.recordingId };
  };

  const backgroundOne = service.process({
    recordingId: "background-1",
    filePath: "background-1",
  });
  const backgroundTwo = service.process({
    recordingId: "background-2",
    filePath: "background-2",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const manual = service.process({
    recordingId: "manual",
    filePath: "manual",
    manual: true,
    restartTranscription: true,
  });
  finishFirst?.();

  await Promise.all([backgroundOne, backgroundTwo, manual]);
  assert.deepEqual(started, ["background-1", "manual", "background-2"]);
});

test("a newer manual transcription pauses an older queued click instead of running it later", async () => {
  const saved: VoiceMemoryRecord[] = [];
  const records = new Map<string, VoiceMemoryRecord>();
  const service = new AiVoiceMemoryService(
    {} as never,
    {} as never,
    {} as never,
    {
      get: async (recordingId: string) => records.get(recordingId),
      save: async (value: VoiceMemoryRecord) => {
        records.set(value.recordingId, value);
        saved.push(value);
        return value;
      },
    } as never,
  );
  const started: string[] = [];
  let finishFirst: (() => void) | undefined;
  const firstFinished = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  (
    service as unknown as {
      processNow: (request: { recordingId: string }) => Promise<VoiceMemoryRecord>;
    }
  ).processNow = async (request) => {
    started.push(request.recordingId);
    if (request.recordingId === "manual-1") await firstFinished;
    return { ...record(), recordingId: request.recordingId, filePath: request.recordingId };
  };

  const first = service.process({ recordingId: "manual-1", filePath: "manual-1", manual: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const superseded = service.process({
    recordingId: "manual-2",
    filePath: "manual-2",
    manual: true,
  });
  const latest = service.process({
    recordingId: "manual-3",
    filePath: "manual-3",
    manual: true,
  });
  finishFirst?.();

  await Promise.all([first, superseded, latest]);
  assert.deepEqual(started, ["manual-1", "manual-3"]);
  assert.equal(records.get("manual-2")?.phase, "paused");
  assert.equal(records.get("manual-2")?.diagnostic?.errorCode, "manual_task_superseded");
  assert.ok(saved.some((item) => item.recordingId === "manual-2"));
});

test("UI transcription retries acknowledge immediately and automatic organization follows transcription", async () => {
  const saved: VoiceMemoryRecord[] = [];
  const store = {
    get: async () => undefined,
    save: async (value: VoiceMemoryRecord) => {
      saved.push(value);
      return value;
    },
  };
  const service = new AiVoiceMemoryService(
    { getTaskCheckpoint: () => undefined } as never,
    {} as never,
    {} as never,
    store as never,
  );
  const requests: Array<{ organize?: boolean; transcribe?: boolean }> = [];
  (service as unknown as { process: AiVoiceMemoryService["process"] }).process = async (
    request,
  ) => {
    requests.push(request);
    return {
      ...record(),
      recordingId: request.recordingId,
      filePath: request.filePath,
    };
  };

  const acknowledged = await service.start({
    recordingId: "fresh-recording",
    filePath: "fresh-recording",
    manual: false,
    organize: true,
  });
  assert.equal(acknowledged.phase, "idle");
  assert.equal(acknowledged.taskStatus, "pending");
  assert.equal(acknowledged.processingStage, "recording");
  assert.ok(acknowledged.taskId);
  assert.equal(acknowledged.diagnostic?.status, "pending");
  assert.equal(saved[0]?.phase, "idle");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    requests.map((request) => request.organize),
    [false, true],
  );
  assert.deepEqual(
    requests.map((request) => request.transcribe),
    [undefined, false],
  );
});

test("the main process forces a clean retry when the UI sends an invalid legacy result", async () => {
  const invalid = {
    ...record(),
    phase: "ready" as const,
    transcriptionPipelineVersion: 6,
    transcript: record().transcript.map((segment) => ({ ...segment, text: "Quoi ?" })),
  };
  const store = {
    get: async () => invalid,
    save: async (value: VoiceMemoryRecord) => value,
  };
  const service = new AiVoiceMemoryService(
    { getTaskCheckpoint: () => undefined } as never,
    {} as never,
    {} as never,
    store as never,
  );
  let acceptedRestart = false;
  (service as unknown as { process: AiVoiceMemoryService["process"] }).process = async (
    request,
  ) => {
    acceptedRestart = request.restartTranscription === true;
    return invalid;
  };

  await service.start({
    recordingId: invalid.recordingId,
    filePath: invalid.filePath,
    manual: true,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(acceptedRestart, true);
});

test("new automatic speech yields a running background organization task", async () => {
  const store = {
    get: async () => undefined,
    save: async (value: VoiceMemoryRecord) => value,
  };
  const service = new AiVoiceMemoryService({} as never, {} as never, {} as never, store as never);
  const organizationController = new AbortController();
  const state = service as unknown as {
    activeAutomatic?: {
      recordingId: string;
      operation: Promise<VoiceMemoryRecord>;
      organizing: boolean;
    };
    controllers: Map<string, AbortController>;
    process: AiVoiceMemoryService["process"];
  };
  state.activeAutomatic = {
    recordingId: "old-organization",
    operation: Promise.resolve(record()),
    organizing: true,
  };
  state.controllers.set("old-organization", organizationController);
  state.process = async (request) => ({
    ...record(),
    recordingId: request.recordingId,
    filePath: request.filePath,
  });

  await service.start({
    recordingId: "new-recording",
    filePath: "new-recording",
    manual: false,
    organize: true,
  });

  assert.equal(organizationController.signal.aborted, true);
});

test("voice memory uses durable per-record files and a compact local search index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-memory-"));
  try {
    const store = new VoiceMemoryStore(root);
    await store.initialize();
    await store.save(record());
    assert.equal((await store.get("C:\\录音\\一号房-01.m4a"))?.transcript.length, 1);
    const results = store.search({ query: "老王 周六" });
    assert.equal(results.length, 0, "unconfirmed speaker names are not invented");
    assert.ok(
      store.search({ query: "周六" }).some((result) => result.startMs === 1_000),
      "indexed transcript results retain their exact seek time",
    );
    assert.ok(
      store.related("最后约的吃饭时间是几点？").some((result) => result.startMs === 1_000),
      "natural questions retrieve related memory fragments without requiring exact full-text matches",
    );
    await store.delete("C:\\录音\\一号房-01.m4a");
    assert.equal(await store.get("C:\\录音\\一号房-01.m4a"), undefined);
    assert.equal(store.search({ query: "周六" }).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("voice processing enters and leaves double talk without changing conservative defaults", () => {
  let state = createVoiceProcessingState();
  state = advanceVoiceProcessingState(state, {
    micRms: 0.04,
    speechProbability: 0.9,
    remoteLevel: 0.05,
    echoCorrelation: 0.7,
    now: 0,
  });
  state = advanceVoiceProcessingState(state, {
    micRms: 0.04,
    speechProbability: 0.9,
    remoteLevel: 0.05,
    echoCorrelation: 0.7,
    now: 40,
  });
  assert.equal(state.mode, "double_talk");
  assert.deepEqual(targetsForVoiceProcessingMode(state.mode), { suppression: 24, rawMix: 0.16 });
  assert.deepEqual(targetsForVoiceProcessingMode("noise"), { suppression: 34, rawMix: 0 });
});
