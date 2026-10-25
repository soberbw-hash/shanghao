import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { SharedVoiceMemoryStore } from "../src/main/shared-voice-memory-store";
import { isTranscriptionExecutionComplete } from "../src/main/remote-transcription";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { aiModelConfigurationUsage } from "../src/main/ai-model-configuration-usage";
import { resolveTranscriptView } from "../src/renderer/src/features/ai/transcriptView";

const fixture = async (
  provider: "cloud" | "custom" | "local",
  fail: boolean | "transient" = false,
  configured = true,
  localAdmissionReason?: string,
  waitForProvider?: () => Promise<void>,
  audioDurationMs = 1000,
  gateway = {},
) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-cloud-routing-"));
  const audio = path.join(directory, "fixture.wav");
  const wav = Buffer.alloc(44 + (audioDurationMs / 1000) * 32_000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  // Synthetic voiced bursts, rather than digital silence paired with invented ASR replies.
  for (let sample = 0; sample < (wav.length - 44) / 2; sample++) {
    if (sample % (30 * 16000) < 16000) wav.writeInt16LE(100, 44 + sample * 2);
  }
  await writeFile(audio, wav);
  const store = new SharedVoiceMemoryStore(path.join(directory, "records"));
  await store.initialize();
  let calls = 0;
  const service = new AiVoiceMemoryService(
    {
      getActiveAsrModel: () => "fun-asr-nano-2512",
      clearTaskCheckpoint: async () => undefined,
      getTaskCheckpoint: () => undefined,
      canRunTask: () => {
        if (localAdmissionReason) return { runnable: false, reason: localAdmissionReason };
        throw new Error("local_admission_reached");
      },
    } as never,
    { validateInputFile: async () => undefined, releaseAsr: () => undefined } as never,
    gateway as never,
    store,
    undefined,
    () => true,
    {
      status: async () => ({ cloudConfigured: configured, customConfigured: configured }),
      transcribe: async (file: string, duration: number, selected: string) => {
        if (provider !== "cloud" && audioDurationMs <= 300000) assert.equal(file, audio);
        else assert.notEqual(file, audio);
        if (provider === "cloud") assert.ok(duration > 0 && duration <= 30000);
        else assert.equal(duration, Math.min(audioDurationMs, 300000));
        assert.equal(selected, provider);
        calls++;
        await waitForProvider?.();
        if (fail === "transient" && calls === 1) throw new Error("cloud_asr_http_500");
        if (fail === true) throw new Error("cloud_asr_http_402");
        return { text: "这是一段用于验证云端转录路由的测试语音。", modelName: "ASR fixture" };
      },
    } as never,
    () => provider,
  );
  const request = {
    recordingId: "fixture-recording",
    filePath: audio,
    roomId: "main",
    roomName: "测试房间",
    manual: true,
    transcribe: true,
    organize: false,
    restartTranscription: true,
    asrModelId: "fun-asr-nano-2512" as const,
  };
  return { directory, store, service, request, calls: () => calls };
};

test("manual fusion processes saved originals through the service without another audio upload", async () => {
  const f = await fixture("cloud", false, true, undefined, undefined, 1000, {
    generateJson: async (request: { prompt: string; roomId: string }) => {
      assert.equal(request.roomId, "main");
      assert.match(request.prompt, /本地语句/);
      return {
        segments: [
          {
            id: "local-fusion",
            text: "这是一段用于验证云端转录路由的测试语音。",
            uncertain: false,
            cloudIds: ["cloud-fusion"],
          },
        ],
      };
    },
  });
  try {
    const cloudRecord = await f.service.process(f.request);
    const cloudSegment = { ...cloudRecord.transcript[0]!, id: "cloud-fusion" };
    await f.store.save({
      ...cloudRecord,
      transcript: [cloudSegment],
      transcriptionAssist: {
        status: "completed",
        cloudModelId: "siliconflow-sensevoice-small",
        localModelId: "qwen3-asr-0.6b-force",
      },
      transcriptionVariants: {
        "siliconflow-sensevoice-small": {
          model: cloudRecord.transcriptionModel!,
          transcript: [cloudSegment],
          speakers: [],
          updatedAt: cloudRecord.updatedAt,
        },
        "qwen3-asr-0.6b-force": {
          model: { id: "qwen3-asr-0.6b-force", name: "Qwen" },
          transcript: [{ ...cloudSegment, id: "local-fusion" }],
          speakers: [],
          updatedAt: cloudRecord.updatedAt,
        },
      },
    });
    const result = await f.service.process({
      ...f.request,
      transcribe: false,
      organize: false,
      fuse: true,
      restartTranscription: false,
    });
    assert.equal(result.transcriptionFusion?.status, "completed");
    assert.equal(result.phase, "ready");
    assert.equal(f.calls(), 1);
    assert.equal(
      result.transcriptionVariants?.["qwen3-asr-0.6b-force"]?.transcript[0]?.id,
      "local-fusion",
    );
    const cleared = await f.service.clearTranscriptionResults(f.request.recordingId);
    assert.equal(cleared.transcriptionFusion, undefined);
    assert.equal(resolveTranscriptView(cleared), undefined);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("normal cloud/custom transcription ignores a retained local model selection", async () => {
  for (const provider of ["cloud", "custom"] as const) {
    const f = await fixture(provider);
    try {
      const result = await f.service.process(f.request);
      assert.equal(f.calls(), 1);
      assert.equal(result.phase, "ready");
      assert.equal(result.taskStatus, "success");
      assert.equal(result.transcript.length > 0, true);
      assert.equal(result.errorMessage, undefined);
      assert.equal(result.transcriptionStats, undefined);
      assert.equal(isTranscriptionExecutionComplete(result), true);
      assert.equal(isTranscriptionExecutionComplete({ ...result, transcript: [] }), false);
      assert.equal(
        isTranscriptionExecutionComplete({
          ...result,
          phase: "organizing",
          taskStatus: "processing",
        }),
        true,
      );
      assert.equal(
        isTranscriptionExecutionComplete({
          ...result,
          phase: "error",
          taskStatus: "failed",
          errorMessage: "organize_failed:test",
        }),
        true,
      );
      assert.equal(
        isTranscriptionExecutionComplete({ ...result, transcriptionElapsedMs: undefined }),
        false,
      );
      assert.equal(
        isTranscriptionExecutionComplete({
          ...result,
          transcriptionModel: {
            id: "fun-asr-nano-2512",
            name: "local fixture",
          },
        }),
        false,
      );
      assert.equal(
        result.transcriptionModel?.id,
        provider === "cloud" ? "siliconflow-sensevoice-small" : "custom-asr-api",
      );
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});

test("a failed cloud resume retains previously saved later parts", async () => {
  let calls = 0;
  const f = await fixture(
    "cloud",
    false,
    true,
    undefined,
    async () => {
      if (++calls === 2) throw Error("cloud_asr_http_402");
    },
    600000,
  );
  try {
    await f.store.save({
      ...createEmptyVoiceMemoryRecord(f.request),
      phase: "paused",
      progress: 75,
      transcriptionModel: { id: "siliconflow-sensevoice-small", name: "ASR fixture" },
      transcript: [
        {
          id: "previous-part-2",
          recordingId: f.request.recordingId,
          startMs: 310000,
          endMs: 311000,
          text: "此前已经保存的后半段文字。",
        },
      ],
    });
    await assert.rejects(
      f.service.process({ ...f.request, restartTranscription: false }),
      /http_402/,
    );
    const saved = await f.store.get(f.request.recordingId);
    assert.equal(
      saved?.transcript.some((segment) => segment.id === "previous-part-2"),
      true,
    );
    assert.ok((saved?.transcript.length ?? 0) > 1);
  } finally {
    f.service.stop();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("a completed API reply can be reparsed and resumed without uploading it again", async () => {
  const f = await fixture("cloud");
  try {
    const first = await f.service.process(f.request);
    assert.equal(first.remoteTranscription?.parts.length, 1);
    const resumed = await f.service.process({ ...f.request, restartTranscription: false });
    assert.equal(f.calls(), 1);
    assert.equal(resumed.transcript.length, first.transcript.length);
    assert.equal(resumed.taskStatus, "success");
    assert.equal(
      isTranscriptionExecutionComplete({
        ...resumed,
        remoteTranscription: { ...resumed.remoteTranscription!, parts: [] },
      }),
      false,
    );
    await f.service.process(f.request);
    assert.equal(f.calls(), 2, "an explicit clean restart must request a fresh response");
    await f.service.clearTranscriptionResults(f.request.recordingId);
    assert.equal((await f.store.get(f.request.recordingId))?.remoteTranscription, undefined);
  } finally {
    f.service.stop();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("manual organization acknowledges the newest shared-store revision on first run and retry", async () => {
  for (const provider of ["cloud", "custom"] as const) {
    const f = await fixture("cloud", false, true, undefined, undefined, 1000, {
      usesLocalOrganizer: () => false,
      organizerProvider: () => provider,
      generateJsonWithMetrics: async () => ({
        value: {
          description: "内容已整理",
          summary: [{ text: "这段合成原文用于验证云端转录路由。" }],
        },
      }),
    });
    try {
      await f.service.process(f.request);
      for (let run = 0; run < 2; run++) {
        const result = await f.service.process({
          ...f.request,
          restartTranscription: false,
          transcribe: false,
          organize: true,
        });
        assert.equal(result.errorMessage, undefined);
        assert.equal(result.organization?.status, "completed");
        assert.equal(result.taskStatus, "success");
        assert.ok(result.summary.length);
      }
    } finally {
      f.service.stop();
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});

test("a combined ASR and cloud summary keeps running when another manual recording queues during its text stage", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const f = await fixture("cloud", false, true, undefined, undefined, 1000, {
    usesLocalOrganizer: () => false,
    organizerProvider: () => "custom",
    generateJsonWithMetrics: async () => {
      entered();
      await gate;
      return { value: { description: "录音整理完成", summary: [{ text: "合成摘要" }] } };
    },
  });
  let first: ReturnType<AiVoiceMemoryService["process"]> | undefined;
  let second: ReturnType<AiVoiceMemoryService["process"]> | undefined;
  try {
    first = f.service.process({ ...f.request, organize: true });
    await started;
    const current = (await f.store.get(f.request.recordingId))!;
    await f.store.save({ ...current, recordingId: "second", organization: undefined });
    second = f.service.process({
      ...f.request,
      recordingId: "second",
      transcribe: false,
      restartTranscription: false,
    });
    release();
    assert.equal((await first).organization?.status, "completed");
    assert.equal((await first).phase, "ready");
    await second;
    assert.equal(f.calls(), 1);
  } finally {
    release();
    await Promise.allSettled([first, second]);
    f.service.stop();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("an external writer during organization keeps its winning result and task identity", async () => {
  let external!: SharedVoiceMemoryStore;
  const f = await fixture("cloud", false, true, undefined, undefined, 1000, {
    usesLocalOrganizer: () => false,
    generateJsonWithMetrics: async () => {
      const current = (await external.get("fixture-recording"))!;
      await external.save({
        ...current,
        taskId: "new-task-owner",
        summary: [{ text: "新任务已保存的摘要" }],
      });
      return { value: { description: "迟到的旧摘要" } };
    },
  });
  try {
    external = new SharedVoiceMemoryStore(path.join(f.directory, "records"));
    await external.initialize();
    await f.service.process(f.request);
    await assert.rejects(
      f.service.process({ ...f.request, transcribe: false, organize: true }),
      /voice_memory_shared_result_changed/,
    );
    const winner = await external.get("fixture-recording");
    assert.equal(winner?.taskId, "new-task-owner");
    assert.equal(winner?.summary[0]?.text, "新任务已保存的摘要");
  } finally {
    f.service.stop();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("a pending cloud response remains visibly transcribing and can be paused", async () => {
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture("cloud", false, true, undefined, async () => {
    started();
    await response;
  });
  try {
    const operation = f.service.process(f.request);
    try {
      await entered;
      assert.equal(aiModelConfigurationUsage.busy, true);
      assert.throws(() => aiModelConfigurationUsage.assertIdle(), /ai_model_configuration_in_use/u);
      const running = await f.store.get(f.request.recordingId);
      assert.equal(running?.phase, "transcribing");
      assert.equal(running?.taskStatus, "processing");
      assert.equal(running?.processingStage, "asr");
    } finally {
      f.service.pause(f.request.recordingId);
      assert.equal(aiModelConfigurationUsage.busy, true, "pause must await provider cleanup");
      release();
      await operation;
    }
    assert.equal((await f.store.get(f.request.recordingId))?.phase, "paused");
    assert.equal(aiModelConfigurationUsage.busy, false);
  } finally {
    f.service.stop();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("pausing an old provider request cannot replace an external winner's task state", async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture("cloud", false, true, undefined, async () => {
    entered();
    await waiting;
  });
  const operation = f.service.process(f.request);
  try {
    await started;
    const external = new SharedVoiceMemoryStore(path.join(f.directory, "records"));
    await external.initialize();
    const current = (await external.get(f.request.recordingId))!;
    await external.save({
      ...current,
      taskId: "external-winner",
      phase: "ready",
      taskStatus: "success",
    });
    f.service.pause(f.request.recordingId);
    release();
    await assert.rejects(operation, /voice_memory_shared_result_changed/);
    const winner = (await external.get(f.request.recordingId))!;
    assert.equal(winner.taskId, "external-winner");
    assert.equal(winner.phase, "ready");
    assert.equal(winner.taskStatus, "success");
  } finally {
    release();
    f.service.stop();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("explicit local model comparison uses local admission despite a cloud default", async () => {
  const f = await fixture("cloud");
  try {
    await assert.rejects(
      f.service.process({ ...f.request, taskId: "model-comparison:fixture" }),
      /local_admission_reached/,
    );
    assert.equal(f.calls(), 0);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("automatic cloud transcription bypasses local game/resource admission", async () => {
  const f = await fixture("cloud");
  try {
    const result = await f.service.process({ ...f.request, manual: false });
    assert.equal(result.phase, "ready");
    assert.equal(f.calls(), 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("a cloud billing rejection is persisted as an ASR failure, not a model comparison error", async () => {
  const f = await fixture("cloud", true);
  try {
    await assert.rejects(f.service.process(f.request), /cloud_asr_http_402/);
    assert.equal(f.calls(), 1);
    const saved = await f.store.get(f.request.recordingId);
    assert.equal(saved?.phase, "error");
    assert.equal(saved?.processingStage, "asr");
    assert.equal(saved?.errorMessage, "cloud_asr_http_402");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("a transient provider failure recovers before the recording is marked failed", async () => {
  const f = await fixture("cloud", "transient");
  try {
    const result = await f.service.process(f.request);
    assert.equal(f.calls(), 2);
    assert.equal(result.phase, "ready");
    assert.equal(result.taskStatus, "success");
    assert.equal(result.errorMessage, undefined);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("automatic recordings await missing provider credentials without uploading or failing", async () => {
  for (const provider of ["cloud", "custom"] as const) {
    const f = await fixture(provider, false, false);
    try {
      const result = await f.service.process({ ...f.request, manual: false });
      assert.equal(result.phase, "paused");
      assert.equal(result.taskStatus, "pending");
      assert.match(result.errorMessage ?? "", /^deferred:(cloud|custom)_asr_key_required$/);
      assert.equal(f.calls(), 0);
    } finally {
      f.service.stop();
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});

test("automatic local recordings await an installed and ready model without downloading", async () => {
  const f = await fixture("local", false, true, "model_fun-asr-nano-2512_not_installed");
  try {
    const result = await f.service.process({ ...f.request, manual: false });
    assert.equal(result.phase, "paused");
    assert.equal(result.taskStatus, "pending");
    assert.equal(result.errorMessage, "deferred:model_fun-asr-nano-2512_not_installed");
    assert.equal(f.calls(), 0);
  } finally {
    f.service.stop();
    await rm(f.directory, { recursive: true, force: true });
  }
});
