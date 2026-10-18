import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AiTranscriptionProviderStore } from "../src/main/ai-transcription-provider-store";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { transcriptionProviderError } from "../src/renderer/src/features/ai/transcriptionProviderError";

const secure = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString(),
};
const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-provider-"));
  const audio = path.join(directory, "fixture.wav");
  await writeFile(audio, Buffer.alloc(16));
  return { directory, audio, file: path.join(directory, "ai", "transcription-provider.enc") };
};

test("ASR credentials remain separate and damaged data is never overwritten", async () => {
  const f = await fixture();
  try {
    const store = new AiTranscriptionProviderStore(f.directory, secure);
    await store.save({ provider: "cloud", apiKey: "cloud-test-key" });
    await store.save({
      provider: "custom",
      baseUrl: "https://8.8.8.8/v1",
      model: "asr",
      apiKey: "custom-test-key",
    });
    assert.deepEqual(await store.clear("custom"), {
      cloudConfigured: true,
      customConfigured: false,
      customBaseUrl: undefined,
      customModel: undefined,
    });
    await writeFile(f.file, "damaged bytes");
    await assert.rejects(
      store.save({ provider: "cloud", apiKey: "replacement" }),
      /config_unreadable/,
    );
    assert.equal(await readFile(f.file, "utf8"), "damaged bytes");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("ASR uses the official model, multipart upload and authorization header", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const fetcher: typeof fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.siliconflow.cn/v1/audio/transcriptions");
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer cloud-test-key");
      assert.equal(options?.redirect, "error");
      const form = options?.body as FormData;
      assert.equal(form.get("model"), "FunAudioLLM/SenseVoiceSmall");
      assert.equal((form.get("file") as File).size, 16);
      return new Response(JSON.stringify({ text: "这是转录测试。" }));
    };
    const store = new AiTranscriptionProviderStore(f.directory, secure, fetcher);
    await store.save({ provider: "cloud", apiKey: "cloud-test-key" });
    assert.equal(
      (await store.transcribe(f.audio, 1000, "cloud", new AbortController().signal)).text,
      "这是转录测试。",
    );
    await assert.rejects(
      store.transcribe(f.audio, 3600001, "cloud", new AbortController().signal),
      /duration_limit/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(store.transcribe(f.audio, 1000, "cloud", controller.signal));
    assert.equal(calls, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("ASR rejects internal custom hosts and bounds streamed results", async () => {
  const f = await fixture();
  try {
    let cancelled = false;
    const store = new AiTranscriptionProviderStore(
      f.directory,
      secure,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(300000));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    await assert.rejects(
      store.save({
        provider: "custom",
        baseUrl: "https://198.18.0.1",
        model: "test",
        apiKey: "test",
      }),
      /private_host/,
    );
    await store.save({ provider: "cloud", apiKey: "test" });
    await assert.rejects(
      store.transcribe(f.audio, 1000, "cloud", new AbortController().signal),
      /response_too_large/,
    );
    assert.equal(cancelled, true);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("ASR account and key errors give actionable messages without raw provider text", () => {
  assert.match(transcriptionProviderError("cloud_asr_http_402")!, /余额不足/);
  assert.match(transcriptionProviderError("cloud_asr_http_401")!, /密钥/);
  assert.match(transcriptionProviderError("cloud_asr_http_429")!, /稍后/);
  assert.equal(transcriptionProviderError("unrelated_failure"), undefined);
});

test("switching a deferred local recording to cloud does not require an installed local model", async () => {
  for (const provider of ["local", "cloud", "custom"] as const) {
    let resumed = 0;
    const service = new AiVoiceMemoryService(
      { canRunTask: () => ({ runnable: false }) } as never,
      {} as never,
      {} as never,
      {
        list: async () => [{ recordingId: "deferred", errorMessage: "deferred:manual_only" }],
      } as never,
      undefined,
      () => true,
      undefined,
      () => provider,
    );
    service.process = async () => {
      resumed++;
      return {} as never;
    };
    await (
      service as unknown as { retryDeferredRecords: () => Promise<void> }
    ).retryDeferredRecords();
    assert.equal(resumed, provider === "local" ? 0 : 1);
  }
});
