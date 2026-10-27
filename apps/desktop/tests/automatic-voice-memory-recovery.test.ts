import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { VoiceMemoryProcessRequest } from "@private-voice/shared";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { AiTextGateway } from "../src/main/ai-text-gateway";

const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-auto-recovery-"));
  const audio = path.join(directory, "synthetic.wav");
  const wav = Buffer.alloc(44 + 32_000);
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
  wav.writeUInt32LE(32_000, 40);
  for (let offset = 44; offset < wav.length; offset += 2) wav.writeInt16LE(100, offset);
  await writeFile(audio, wav);
  const state = {
    asrReady: false,
    textReady: false,
    organizeEnabled: true,
    asrCalls: 0,
    textCalls: 0,
    failAsr: false,
    failText: false,
    failFusion: false,
  };
  const services: AiVoiceMemoryService[] = [];
  const failures: string[] = [];
  const open = async () => {
    const store = new VoiceMemoryStore(path.join(directory, "records"));
    await store.initialize();
    const service = new AiVoiceMemoryService(
      {
        getActiveAsrModel: () => "fun-asr-nano-2512",
        getTaskCheckpoint: () => undefined,
        onStatus: () => () => {},
      } as never,
      { validateInputFile: async () => undefined, releaseAsr: () => undefined } as never,
      {
        usesLocalOrganizer: () => false,
        organizerProvider: () => "custom",
        generateJson: async () => {
          if (state.failFusion) throw new Error("cloud_asr_network_error");
          return {
            segments: [
              {
                id: "local-fusion",
                text: "这是用于验证后台恢复的合成语音内容。",
                uncertain: false,
                cloudIds: ["cloud-fusion"],
              },
            ],
          };
        },
        assertOrganizerConfigured: async () => {
          if (!state.textReady) throw new Error("custom_ai_not_configured");
        },
        generateJsonWithMetrics: async () => {
          state.textCalls++;
          if (state.failText) throw new Error("cloud_ai_provider_unavailable");
          if (!state.textReady) throw new Error("custom_ai_not_configured");
          return {
            value: { description: "合成测试文字。", summary: [{ text: "只使用合成夹具。" }] },
          };
        },
      } as never,
      store,
      async (payload) => {
        if (payload.level === "error") failures.push(JSON.stringify(payload));
      },
      () => true,
      {
        status: async () => ({ cloudConfigured: state.asrReady }),
        transcribe: async () => {
          state.asrCalls++;
          if (state.failAsr) throw new Error("cloud_asr_http_500");
          return { text: "这是用于验证后台恢复的合成语音内容。", modelName: "synthetic ASR" };
        },
      } as never,
      () => "cloud",
      () => state.organizeEnabled,
    );
    services.push(service);
    const process = service.process.bind(service);
    service.process = (request) =>
      process(request).catch((error) => {
        failures.push(String(error));
        throw error;
      });
    return {
      store,
      service,
      retry: () =>
        (service as unknown as { retryDeferredRecords(): Promise<void> }).retryDeferredRecords(),
    };
  };
  const request: VoiceMemoryProcessRequest = {
    recordingId: "synthetic",
    filePath: audio,
    manual: false,
    transcribe: true,
    organize: false,
  };
  return {
    state,
    failures,
    open,
    request,
    close: async () => {
      services.forEach((service) => service.stop());
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("continuous model download updates cannot postpone an existing cloud retry timer", async (t) => {
  const f = await fixture();
  try {
    const current = await f.open();
    const internal = current.service as unknown as {
      scheduleDeferredRetry(): void;
      retryDeferredRecords(): Promise<void>;
    };
    let retries = 0;
    internal.retryDeferredRecords = async () => {
      retries++;
    };
    t.mock.timers.enable({ apis: ["setTimeout"] });
    internal.scheduleDeferredRetry();
    for (let second = 0; second < 8; second++) {
      t.mock.timers.tick(1000);
      internal.scheduleDeferredRetry();
    }
    assert.equal(retries, 0);
    t.mock.timers.tick(1000);
    assert.equal(retries, 1, "the original nine-second timer must still fire during downloads");
  } finally {
    t.mock.timers.reset();
    await f.close();
  }
});

test("transient ASR recovery survives restart and backs off without requiring a manual retry", async () => {
  const f = await fixture();
  try {
    f.state.asrReady = true;
    f.state.failAsr = true;
    const first = await f.open();
    const waiting = await first.service.process(f.request);
    assert.equal(waiting.errorMessage, "deferred:cloud_asr_http_500");
    assert.equal(waiting.remoteTranscriptionRetry?.attempts, 1);
    first.service.stop();
    const restored = await f.open();
    const calls = f.state.asrCalls;
    await restored.retry();
    assert.equal(f.state.asrCalls, calls, "restart cannot bypass the saved backoff");
    for (let round = 1; round <= 2; round++) {
      const current = (await restored.store.get("synthetic"))!;
      await restored.store.save({
        ...current,
        remoteTranscriptionRetry: { attempts: round, nextAttemptAt: 0 },
      });
      await restored.retry();
    }
    const exhausted = (await restored.store.get("synthetic"))!;
    assert.equal(exhausted.phase, "paused", f.failures.join("\n"));
    assert.equal(exhausted.remoteTranscriptionRetry?.attempts, 2);
    const failedCalls = f.state.asrCalls;
    await restored.retry();
    assert.equal(f.state.asrCalls, failedCalls);
    f.state.failAsr = false;
    await restored.store.save({
      ...exhausted,
      remoteTranscriptionRetry: { attempts: 2, nextAttemptAt: 0 },
    });
    await restored.retry();
    const completed = await restored.store.get("synthetic");
    assert.equal(completed?.phase, "ready");
    assert.equal(completed?.remoteTranscriptionRetry, undefined);
  } finally {
    await f.close();
  }
});

test("deferred ASR preserves each recording's organization opt-out across store restart", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const waiting = await first.service.process(f.request);
    assert.equal(waiting.autoOrganizeRequested, false);
    first.service.stop();
    f.state.asrReady = true;
    f.state.textReady = true;
    const restored = await f.open();
    await restored.retry();
    const record = await restored.store.get("synthetic");
    assert.equal(record?.taskStatus, "success");
    assert.equal(record?.autoOrganizeRequested, false);
    assert.equal(f.state.asrCalls, 1);
    assert.equal(f.state.textCalls, 0, "opt-out never sends the transcript to a text provider");
  } finally {
    await f.close();
  }
});

test("a foreground transcription always follows with a summary even for a legacy false choice", async () => {
  const f = await fixture();
  try {
    f.state.asrReady = true;
    f.state.textReady = true;
    const { service, store } = await f.open();
    const finished = new Promise<void>((resolve) => {
      const stop = service.onStatus((record) => {
        if (record.phase === "ready" && record.organization?.status === "completed") {
          stop();
          resolve();
        }
      });
    });
    const accepted = await service.start({ ...f.request, manual: true, organize: false });
    assert.equal(accepted.autoOrganizeRequested, true);
    await finished;
    assert.equal((await store.get("synthetic"))?.organization?.status, "completed");
    assert.equal(f.state.asrCalls, 1);
    assert.ok(f.state.textCalls > 0);
  } finally {
    await f.close();
  }
});

test("legacy deferred records with no organization consent recover as transcription only", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const waiting = await first.service.process(f.request);
    delete waiting.autoOrganizeRequested;
    await first.store.save(waiting);
    first.service.stop();
    f.state.asrReady = true;
    f.state.textReady = true;
    const restored = await f.open();
    await restored.retry();
    assert.equal(f.state.asrCalls, 1);
    assert.equal(f.state.textCalls, 0);
  } finally {
    await f.close();
  }
});

test("the accepted automatic request retains organization consent before the transcription-only phase", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const deferred = new Promise<void>((resolve) => {
      const off = first.service.onStatus((record) => {
        if (record.errorMessage === "deferred:cloud_asr_not_configured") {
          off();
          resolve();
        }
      });
    });
    const queued = await first.service.start({ ...f.request, organize: true });
    assert.equal(queued.autoOrganizeRequested, true);
    await deferred;
    assert.equal((await first.store.get("synthetic"))?.autoOrganizeRequested, true);
    first.service.stop();
    f.state.asrReady = true;
    f.state.textReady = true;
    const restored = await f.open();
    await restored.retry();
    assert.equal((await restored.store.get("synthetic"))?.organization?.status, "completed");
    assert.equal(f.state.asrCalls, 1);
  } finally {
    await f.close();
  }
});

test("the real text gateway checks custom credentials before an automatic organizer attempt", async () => {
  let configured = false;
  const gateway = new AiTextGateway(
    { getSnapshot: () => ({ aiOrganizerProvider: "custom" }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { status: async () => ({ configured }) } as never,
    {} as never,
  );
  await assert.rejects(gateway.assertOrganizerConfigured(), /custom_ai_not_configured/);
  configured = true;
  await gateway.assertOrganizerConfigured();
});

test("an explicit manual organization request retains its per-record recovery choice", async () => {
  const f = await fixture();
  try {
    f.state.asrReady = true;
    f.state.textReady = true;
    const first = await f.open();
    await first.service.process({ ...f.request, manual: true, organize: true });
    first.service.stop();
    const restored = await f.open();
    assert.equal((await restored.store.get("synthetic"))?.autoOrganizeRequested, true);
  } finally {
    await f.close();
  }
});

test("missing text configuration waits without spending attempts and resumes without a second ASR", async () => {
  const f = await fixture();
  try {
    f.state.asrReady = true;
    const first = await f.open();
    const waiting = await first.service.process({ ...f.request, organize: true });
    assert.equal(waiting.autoOrganizeRequested, true);
    assert.equal(waiting.phase, "paused");
    assert.equal(waiting.taskStatus, "pending");
    assert.equal(waiting.errorMessage, "deferred:custom_ai_not_configured");
    assert.ok(waiting.transcript.length);
    assert.equal(waiting.organization, undefined);
    assert.equal(f.state.textCalls, 0, "missing configuration consumes no organization attempt");
    first.service.stop();
    f.state.textReady = true;
    const restored = await f.open();
    await restored.retry();
    const completed = await restored.store.get("synthetic");
    assert.equal(completed?.taskStatus, "success");
    assert.equal(completed?.organization?.status, "completed");
    assert.equal(f.state.asrCalls, 1, "durable completed ASR is not uploaded again");
    assert.ok(f.state.textCalls > 0);
  } finally {
    await f.close();
  }
});

test("cloud summary failures automatically resume saved text after repeated outages without reuploading audio", async () => {
  const f = await fixture();
  try {
    f.state.asrReady = f.state.textReady = f.state.failText = true;
    const current = await f.open();
    let record = await current.service.process({ ...f.request, organize: true });
    for (let round = 0; round < 4; round++) {
      assert.equal(record.errorMessage, "deferred:cloud_asr_http_503");
      assert.equal(record.phase, "paused");
      assert.ok(record.transcript.length);
      await current.store.save({
        ...record,
        remoteTranscriptionRetry: { attempts: Math.min(2, round + 1), nextAttemptAt: 0 },
      });
      if (round === 3) f.state.failText = false;
      await current.retry();
      record = (await current.store.get("synthetic"))!;
    }
    assert.equal(record.organization?.status, "completed");
    assert.equal(record.taskStatus, "success");
    assert.equal(f.state.asrCalls, 1);
  } finally {
    await f.close();
  }
});

test("fusion network failures preserve the summary and recover without a second ASR", async () => {
  const f = await fixture();
  try {
    f.state.asrReady = f.state.textReady = true;
    const current = await f.open();
    const cloud = await current.service.process(f.request);
    const segment = { ...cloud.transcript[0]!, id: "cloud-fusion" };
    await current.store.save({
      ...cloud,
      transcript: [segment],
      autoOrganizeRequested: true,
      transcriptionAssist: {
        status: "completed",
        cloudModelId: "siliconflow-sensevoice-small",
        localModelId: "qwen3-asr-0.6b-force",
      },
      transcriptionVariants: {
        "siliconflow-sensevoice-small": {
          model: { id: "siliconflow-sensevoice-small", name: "cloud" },
          transcript: [segment],
          speakers: cloud.speakers,
          updatedAt: cloud.updatedAt,
        },
        "qwen3-asr-0.6b-force": {
          model: { id: "qwen3-asr-0.6b-force", name: "local" },
          transcript: [{ ...segment, id: "local-fusion" }],
          speakers: cloud.speakers,
          updatedAt: cloud.updatedAt,
        },
      },
    });
    f.state.failFusion = true;
    const waiting = await current.service.process({
      ...f.request,
      transcribe: false,
      organize: true,
    });
    assert.equal(waiting.errorMessage, "deferred:cloud_asr_network_error");
    assert.equal(
      waiting.organization?.status,
      "completed",
      "summary is independent of fusion availability",
    );
    const summaries = f.state.textCalls;
    f.state.failFusion = false;
    await current.store.save({
      ...waiting,
      remoteTranscriptionRetry: { attempts: 1, nextAttemptAt: 0 },
    });
    await current.retry();
    const completed = (await current.store.get("synthetic"))!;
    assert.equal(completed.transcriptionFusion?.status, "completed");
    assert.equal(completed.taskStatus, "success");
    assert.equal(f.state.asrCalls, 1);
    assert.ok(
      f.state.textCalls > summaries,
      "completed fusion refreshes the summary from corrected text",
    );
    assert.equal(
      completed.transcriptionVariants?.["siliconflow-sensevoice-small"]?.transcript[0]?.id,
      "cloud-fusion",
    );
  } finally {
    await f.close();
  }
});

test("startup resumes interrupted jobs but leaves explicit pauses alone", async () => {
  const f = await fixture();
  try {
    const current = await f.open();
    const waiting = await current.service.process(f.request);
    await current.store.save({ ...waiting, phase: "transcribing", errorMessage: undefined });
    await current.store.save({
      ...waiting,
      recordingId: "explicit-pause",
      phase: "paused",
      errorMessage: undefined,
      remoteTranscriptionRetry: { attempts: 4, nextAttemptAt: 12345 },
    });
    await current.service.initialize();
    assert.equal((await current.store.get("synthetic"))?.errorMessage, "deferred:app_restarted");
    assert.equal((await current.store.get("explicit-pause"))?.errorMessage, undefined);
    assert.equal(
      (await current.store.get("explicit-pause"))?.remoteTranscriptionRetry?.attempts,
      2,
    );
    f.state.asrReady = true;
    await current.retry();
    assert.equal((await current.store.get("synthetic"))?.phase, "ready");
    assert.equal((await current.store.get("explicit-pause"))?.phase, "paused");
    assert.equal(f.state.asrCalls, 1);
  } finally {
    await f.close();
  }
});

test("switching automatic organization off while configuration is pending suppresses recovery upload", async () => {
  const f = await fixture();
  try {
    f.state.asrReady = true;
    const first = await f.open();
    await first.service.process({ ...f.request, organize: true });
    first.service.stop();
    f.state.textReady = true;
    f.state.organizeEnabled = false;
    const restored = await f.open();
    await restored.retry();
    assert.equal(f.state.asrCalls, 1);
    assert.equal(f.state.textCalls, 0);
    assert.equal((await restored.store.get("synthetic"))?.taskStatus, "success");
  } finally {
    await f.close();
  }
});
