import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { isTranscriptionExecutionComplete } from "../src/main/remote-transcription";

const fixture = async (
  provider: "cloud" | "custom" | "local",
  fail: boolean | "transient" = false,
  configured = true,
  localAdmissionReason?: string,
) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-cloud-routing-"));
  const audio = path.join(directory, "fixture.wav");
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
  await writeFile(audio, wav);
  const store = new VoiceMemoryStore(path.join(directory, "records"));
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
    {} as never,
    store,
    undefined,
    () => false,
    {
      status: async () => ({ cloudConfigured: configured, customConfigured: configured }),
      transcribe: async (file: string, duration: number, selected: string) => {
        assert.equal(file, audio);
        assert.equal(duration, 1000);
        assert.equal(selected, provider);
        calls++;
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
