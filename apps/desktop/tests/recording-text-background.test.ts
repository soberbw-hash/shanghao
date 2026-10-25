import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AiTextGateway } from "../src/main/ai-text-gateway";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { SharedVoiceMemoryStore } from "../src/main/shared-voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";

test("a retained local text choice uses the configured cloud HTTPS provider without local inference", async () => {
  const gateway = new AiTextGateway(
    { getSnapshot: () => ({ aiOrganizerProvider: "local" }) } as never,
    {} as never,
    {} as never,
    {
      requestCloudAi: async () => {
        throw new Error("room_socket_must_not_own_summary");
      },
    } as never,
    {
      generateJson: async () => ({ description: "云端摘要" }),
      status: async () => ({ configured: true }),
    } as never,
    {
      generateJson: async () => {
        throw new Error("local_text_inference_must_not_start");
      },
    } as never,
  );
  assert.equal(gateway.organizerProvider(), "custom");
  await gateway.assertOrganizerConfigured();
  assert.deepEqual(
    await gateway.generateJson({
      purpose: "organize",
      prompt: "合成转录",
      manual: true,
      maxNewTokens: 1000,
    }),
    { description: "云端摘要" },
  );
  const missing = new AiTextGateway(
    { getSnapshot: () => ({ aiOrganizerProvider: "local" }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { status: async () => ({ configured: false }) } as never,
    {} as never,
  );
  await assert.rejects(missing.assertOrganizerConfigured(), /custom_ai_not_configured/);
});

test("recording summaries use their own transcript after room memory becomes unavailable", async () => {
  let joinedRoom: string | undefined = "room-a";
  const gateway = new AiTextGateway(
    { getSnapshot: () => ({ aiOrganizerProvider: "custom" }) } as never,
    {} as never,
    {} as never,
    { getJoinedRoomId: () => joinedRoom } as never,
    {
      generateJson: async ({ prompt, signal }: { prompt: string; signal?: AbortSignal }) => {
        signal?.throwIfAborted();
        return { description: prompt };
      },
    } as never,
    {} as never,
    async () => {
      throw new Error("room_memory_access_denied");
    },
  );
  joinedRoom = undefined;
  assert.deepEqual(
    await gateway.generateJson({
      purpose: "organize",
      roomId: "room-a",
      prompt: "合成录音原文",
      maxNewTokens: 1000,
      manual: true,
    }),
    { description: "合成录音原文" },
  );
  await assert.rejects(
    gateway.generateJson({
      purpose: "question",
      roomId: "room-a",
      prompt: "房间问题",
      maxNewTokens: 1000,
      manual: true,
    }),
    /room_memory_access_denied/,
  );
});

for (const action of ["navigate", "pause", "manual", "automatic"] as const) {
  test(`Main-owned summary survives ${action} while explicit pause remains resumable`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-background-summary-"));
    const store = new SharedVoiceMemoryStore(directory);
    await store.initialize();
    const source = {
      ...createEmptyVoiceMemoryRecord({
        recordingId: "synthetic",
        filePath: "unused.wav",
        roomId: "main",
      }),
      phase: "ready" as const,
      taskStatus: "success" as const,
      transcriptionModel: { id: "siliconflow-sensevoice-small" as const, name: "synthetic" },
      transcriptionElapsedMs: 100,
      transcript: Array.from({ length: 8 }, (_, index) => ({
        id: `synthetic-${index}`,
        recordingId: "synthetic",
        speakerId: "synthetic-speaker",
        startMs: index * 30 * 60_000,
        endMs: index * 30 * 60_000 + 20_000,
        text: `这是第${index}段用于验证后台任务持续运行的合成录音文字。`,
      })),
    };
    await store.save(source);
    await store.save({ ...source, recordingId: "second" });
    let joinedRoom: string | undefined = "main";
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let requests = 0;
    const gateway = new AiTextGateway(
      { getSnapshot: () => ({ aiOrganizerProvider: "custom" }) } as never,
      {} as never,
      {} as never,
      { getJoinedRoomId: () => joinedRoom } as never,
      {
        status: async () => ({ configured: true }),
        generateJson: async ({ signal }: { signal?: AbortSignal }) => {
          if (++requests === 2) {
            entered();
            await gate;
          }
          signal?.throwIfAborted();
          return { description: "合成的录音摘要", summary: [{ text: "全部录音按分块处理。" }] };
        },
      } as never,
      {} as never,
      async () => {
        if (!joinedRoom) throw new Error("room_memory_access_denied");
        return "仅房间问答使用的上下文";
      },
    );
    const service = new AiVoiceMemoryService({} as never, {} as never, gateway, store);
    const unsubscribe = service.onStatus(() => {});
    let operation: Promise<unknown> | undefined;
    let next: Promise<unknown> | undefined;
    try {
      operation = service.process({
        recordingId: source.recordingId,
        filePath: source.filePath,
        manual: action !== "automatic",
        transcribe: false,
        organize: true,
      });
      await started;
      const running = await store.get(source.recordingId);
      assert.equal(running?.organization?.completedChunks, 1);
      assert.equal(running?.phase, "organizing");
      unsubscribe();
      joinedRoom = undefined;
      if (action === "pause") await service.pause(source.recordingId);
      if (action === "manual")
        next = service.process({
          recordingId: "second",
          filePath: source.filePath,
          manual: true,
          transcribe: false,
          organize: false,
        });
      if (action === "automatic") {
        (
          service as unknown as {
            queueAutomaticProcess(request: object, historical: boolean): void;
          }
        ).queueAutomaticProcess(
          { recordingId: "second", filePath: source.filePath, transcribe: false, organize: false },
          false,
        );
        next = service.process({
          recordingId: "second",
          filePath: source.filePath,
          transcribe: false,
          organize: false,
        });
      }
      release();
      await operation;
      const checkpoint = (await store.get(source.recordingId))!;
      if (action === "pause") {
        assert.equal(checkpoint.phase, "paused");
        assert.equal(checkpoint.organization?.completedChunks, 1);
        operation = service.process({
          recordingId: source.recordingId,
          filePath: source.filePath,
          manual: true,
          transcribe: false,
          organize: true,
        });
        await operation;
      }
      const result = (await store.get(source.recordingId))!;
      assert.equal(result.phase, "ready");
      assert.equal(result.organization?.status, "completed");
      assert.ok(result.organization!.chunks.length > 2);
      assert.ok(result.organization!.chunks.every((chunk) => chunk.status === "completed"));
      assert.deepEqual(
        result.transcript.map(({ words: _words, ...segment }) => segment),
        source.transcript,
      );
      assert.ok(result.summary.length);
      assert.equal(result.organizationPublication, undefined);
    } finally {
      release();
      await operation?.catch(() => undefined);
      await next?.catch(() => undefined);
      service.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
