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
  await writeFile(audio, wav);
  const state = {
    asrReady: false,
    textReady: false,
    organizeEnabled: true,
    asrCalls: 0,
    textCalls: 0,
  };
  const services: AiVoiceMemoryService[] = [];
  const open = async () => {
    const store = new VoiceMemoryStore(path.join(directory, "records"));
    await store.initialize();
    const service = new AiVoiceMemoryService(
      { getActiveAsrModel: () => "fun-asr-nano-2512", getTaskCheckpoint: () => undefined } as never,
      { validateInputFile: async () => undefined, releaseAsr: () => undefined } as never,
      {
        usesLocalOrganizer: () => false,
        organizerProvider: () => "custom",
        assertOrganizerConfigured: async () => {
          if (!state.textReady) throw new Error("custom_ai_not_configured");
        },
        generateJsonWithMetrics: async () => {
          state.textCalls++;
          if (!state.textReady) throw new Error("custom_ai_not_configured");
          return {
            value: { description: "合成测试文字。", summary: [{ text: "只使用合成夹具。" }] },
          };
        },
      } as never,
      store,
      undefined,
      () => true,
      {
        status: async () => ({ cloudConfigured: state.asrReady }),
        transcribe: async () => {
          state.asrCalls++;
          return { text: "这是用于验证后台恢复的合成语音内容。", modelName: "synthetic ASR" };
        },
      } as never,
      () => "cloud",
      () => state.organizeEnabled,
    );
    services.push(service);
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
    open,
    request,
    close: async () => {
      services.forEach((service) => service.stop());
      await rm(directory, { recursive: true, force: true });
    },
  };
};

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
        if (record.errorMessage === "deferred:cloud_asr_key_required") {
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
