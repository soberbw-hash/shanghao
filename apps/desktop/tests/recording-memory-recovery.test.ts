import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { SharedVoiceMemoryStore } from "../src/main/shared-voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { reconcileRecordingMemories } from "../src/main/recording-memory-recovery";
import type { RecordingLibrarySnapshot, VoiceMemoryRecord } from "@private-voice/shared";

for (const kind of [
  "safe",
  "newer-mtime",
  "different-recorded-at",
  "missing-recorded-at",
  "stable-wins",
  "late-stable-wins",
  "source-changes-after-copy",
] as const) {
  test(`catalog recovery ${kind} preserves originals without invoking ASR`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-memory-recovery-"));
    const store = new SharedVoiceMemoryStore(directory);
    await store.initialize();
    const originalPath = "C:\\Isolated\\Original.m4a";
    const recordedAt = "2026-10-20T00:00:00.000Z";
    const legacy: VoiceMemoryRecord = {
      ...createEmptyVoiceMemoryRecord({
        recordingId: originalPath,
        filePath: originalPath,
        recordedAt,
      }),
      createdAt: "2026-10-21T00:00:00.000Z",
      updatedAt: "2026-10-21T01:00:00.000Z",
      phase: "ready" as const,
      transcriptionModel: { id: "siliconflow-sensevoice-small" as const, name: "synthetic" },
      transcript: [
        {
          id: "original",
          recordingId: originalPath,
          text: "隔离夹具的旧原文。",
          speakerId: "speaker",
          startMs: 0,
          endMs: 1000,
        },
      ],
      summary: [{ text: "隔离旧摘要" }],
      recordedAt: kind === "missing-recorded-at" ? undefined : recordedAt,
    };
    legacy.transcriptionAssist = {
      status: "completed",
      cloudModelId: "siliconflow-sensevoice-small",
      localModelId: "qwen3-asr-0.6b-force",
    };
    legacy.transcriptionVariants = {
      "siliconflow-sensevoice-small": {
        model: legacy.transcriptionModel!,
        transcript: legacy.transcript,
        speakers: [],
        updatedAt: legacy.updatedAt,
      },
      "qwen3-asr-0.6b-force": {
        model: { id: "qwen3-asr-0.6b-force", name: "synthetic local" },
        transcript: [{ ...legacy.transcript[0]!, id: "local", text: "独立保存的本地原文。" }],
        speakers: [],
        updatedAt: legacy.updatedAt,
      },
    };
    legacy.transcriptionFusion = {
      status: "completed",
      sourceSignature: "a".repeat(64),
      completedBatches: 1,
      totalBatches: 1,
      speakers: [],
      transcript: [
        {
          ...legacy.transcript[0]!,
          id: "local",
          text: "独立保存的校对稿。",
          fusionUncertain: false,
        },
      ],
    };
    await store.save(legacy);
    if (kind === "stable-wins")
      await store.save({
        ...legacy,
        recordingId: "stable-id",
        transcript: [
          { ...legacy.transcript[0]!, recordingId: "stable-id", text: "稳定身份已保存的原文。" },
        ],
      });
    const service = new AiVoiceMemoryService({} as never, {} as never, {} as never, store);
    if (kind === "source-changes-after-copy") {
      const otherProcess = new SharedVoiceMemoryStore(directory);
      await otherProcess.initialize();
      const save = store.save.bind(store);
      store.save = async (...args) => {
        const saved = await save(...args);
        if (args[0].recordingId === "stable-id")
          await otherProcess.save({
            ...(await otherProcess.get(originalPath))!,
            transcript: [{ ...legacy.transcript[0]!, text: "另一进程刚保存的新原文。" }],
          });
        return saved;
      };
    }
    if (kind === "late-stable-wins") {
      const reconcile = service.reconcileRecordingIdentity.bind(service);
      service.reconcileRecordingIdentity = async (...args) => {
        await store.save({
          ...legacy,
          recordingId: "stable-id",
          transcript: [
            { ...legacy.transcript[0]!, recordingId: "stable-id", text: "稳定身份已保存的原文。" },
          ],
        });
        return reconcile(...args);
      };
    }
    const snapshot: RecordingLibrarySnapshot = {
      directory: "C:\\Isolated",
      totalBytes: 1,
      quotaBytes: 10,
      items: [
        {
          id: "stable-id",
          recordingId: "stable-id",
          filePath: "c:/isolated/original.m4a",
          fileName: "original.m4a",
          title: "隔离录音",
          mediaUrl: "unused",
          fileSize: 1,
          isFavorite: false,
          markers: [],
          createdAt: kind === "different-recorded-at" ? "2026-10-19T00:00:00.000Z" : recordedAt,
          modifiedAt:
            kind === "newer-mtime" ? "2026-10-22T00:00:00.000Z" : "2026-10-20T00:30:00.000Z",
        },
      ],
    };
    try {
      const recovered = await reconcileRecordingMemories(snapshot, service);
      const stable = await service.get("stable-id");
      if (kind === "safe") {
        assert.equal(stable?.transcript[0]?.text, legacy.transcript[0]?.text);
        assert.equal(stable?.transcript[0]?.recordingId, "stable-id");
        assert.equal(stable?.summary[0]?.text, legacy.summary[0]?.text);
        assert.equal(
          stable?.transcriptionVariants?.["qwen3-asr-0.6b-force"]?.transcript[0]?.text,
          "独立保存的本地原文。",
        );
        assert.equal(
          stable?.transcriptionVariants?.["siliconflow-sensevoice-small"]?.transcript[0]?.text,
          "隔离夹具的旧原文。",
        );
        assert.equal(stable?.transcriptionFusion?.transcript[0]?.text, "独立保存的校对稿。");
        assert.equal(recovered.items[0]?.voiceMemoryRecovery, undefined);
        const reopened = new SharedVoiceMemoryStore(directory);
        await reopened.initialize();
        const restored = await reopened.get("stable-id");
        assert.deepEqual(restored?.transcriptionVariants, stable?.transcriptionVariants);
        assert.deepEqual(restored?.transcriptionFusion, stable?.transcriptionFusion);
      } else if (kind === "source-changes-after-copy") {
        const reopened = new SharedVoiceMemoryStore(directory);
        await reopened.initialize();
        assert.equal(
          (await reopened.get(originalPath))?.transcript[0]?.text,
          "另一进程刚保存的新原文。",
        );
        assert.equal(
          (await reopened.get("stable-id"))?.transcript[0]?.text,
          legacy.transcript[0]?.text,
        );
      } else if (kind === "stable-wins" || kind === "late-stable-wins") {
        assert.equal(stable?.transcript[0]?.text, "稳定身份已保存的原文。");
        assert.equal(recovered.items[0]?.voiceMemoryRecovery, undefined);
        assert.ok(await service.get(originalPath));
      } else {
        assert.equal(stable, undefined);
        assert.equal(recovered.items[0]?.voiceMemoryRecovery, "legacy_unverified");
        assert.deepEqual((await service.get(originalPath))?.transcript, legacy.transcript);
      }
      assert.equal(service.hasActiveTask(), false);
    } finally {
      service.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
