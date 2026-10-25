import assert from "node:assert/strict";
import test from "node:test";
import { assistCloudTranscription } from "../src/main/cloud-local-transcription";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { hybridOrganizationContext } from "../src/main/hybrid-organization-context";
import { statsFromTranscriptionUnits } from "../src/main/voice-memory-transcription-units";
import type { VoiceMemoryRecord } from "@private-voice/shared";
import { isVoiceMemoryRecord } from "../src/main/voice-memory-store";
import { transcribeWithRemoteProvider } from "../src/main/remote-transcription";

const fixture = () => {
  let current: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord({
      recordingId: "hybrid",
      filePath: "fixture.wav",
      roomId: "room-a",
    }),
    phase: "ready",
    progress: 100,
    transcriptionPipelineVersion: 10,
    transcriptionModel: { id: "siliconflow-sensevoice-small", name: "cloud" },
    transcriptionElapsedMs: 120,
    transcript: [
      {
        id: "cloud-sentence",
        recordingId: "hybrid",
        text: "我们集合吧。",
        startMs: 0,
        endMs: 30000,
        speakerId: "Speaker 1",
      },
    ],
  };
  const controller = new AbortController();
  let ownedRevision = current.updatedAt;
  const host = {
    signal: controller.signal,
    reload: async () => current,
    ownsRevision: (record: VoiceMemoryRecord) => record.updatedAt === ownedRevision,
    save: async (next: VoiceMemoryRecord) => {
      assert.equal(next.updatedAt, current.updatedAt, "must carry the latest stored revision");
      current = { ...next, updatedAt: new Date(Date.parse(current.updatedAt) + 1).toISOString() };
      ownedRevision = current.updatedAt;
      return current;
    },
  };
  return {
    get current() {
      return current;
    },
    controller,
    host,
    foreignSave: (next: VoiceMemoryRecord) => {
      current = { ...next, updatedAt: new Date(Date.parse(current.updatedAt) + 1).toISOString() };
    },
  };
};

test("a stronger selected assist model is used and preserved in the saved result", async () => {
  const f = fixture();
  let selected: string | undefined;
  await assistCloudTranscription(f.current, {
    ...f.host,
    localModelId: "qwen3-asr-1.7b-force",
    local: async (input) => {
      selected = input.transcriptionAssist?.localModelId;
      throw Error("fixture_inference_failed");
    },
  });
  assert.equal(selected, "qwen3-asr-1.7b-force");
  assert.equal(isVoiceMemoryRecord(f.current), true);
});

test("missing local assist model keeps a successful cloud result without starting local work", async () => {
  const f = fixture();
  const cloudTranscript = f.current.transcript;
  const result = await assistCloudTranscription(f.current, {
    ...f.host,
    localModelId: "qwen3-asr-0.6b-force",
    isLocalReady: () => false,
    local: async () => assert.fail("unprepared model must not run"),
  });
  assert.equal(result.phase, "ready");
  assert.equal(result.progress, 100);
  assert.equal(result.taskStatus, "success");
  assert.equal(result.transcriptionModel?.id, "siliconflow-sensevoice-small");
  assert.deepEqual(result.transcript, cloudTranscript);
  assert.equal(result.transcriptionAssist?.status, "unavailable");
  assert.equal(isVoiceMemoryRecord(result), true);
});

test("cloud provider reuses its saved result when the selected assistance model is missing", async () => {
  const f = fixture();
  const result = await transcribeWithRemoteProvider({
    record: f.current,
    provider: "cloud",
    ...f.host,
    assistModelId: "qwen3-asr-1.7b-force",
    isAssistModelReady: () => false,
    store: {
      status: async () => ({ cloudConfigured: true }),
      transcribe: async () => assert.fail("saved cloud output must not be uploaded again"),
    } as never,
    updateDiagnostic: async (record) => record,
    assist: async () => assert.fail("unprepared local model must not start"),
  });
  assert.equal(result.transcriptionAssist?.localModelId, "qwen3-asr-1.7b-force");
  assert.equal(result.transcriptionAssist?.status, "unavailable");
  assert.equal(result.taskStatus, "success");
});

test("hybrid retains both results, uses local timestamps, and keeps cloud context inside the room", async () => {
  const f = fixture();
  const result = await assistCloudTranscription(f.current, {
    ...f.host,
    local: async (input) => {
      assert.equal(input.transcriptionAssist?.localModelId, "qwen3-asr-0.6b-force");
      assert.equal(input.roomId, "room-a");
      assert.deepEqual(input.transcript, []);
      assert.ok(input.transcriptionVariants?.["siliconflow-sensevoice-small"]);
      const transcript = [
        {
          ...f.current.transcript[0]!,
          id: "local-sentence",
          startMs: 5200,
          endMs: 6500,
          text: "我们集合。",
        },
      ];
      const stats = statsFromTranscriptionUnits(30000, [], transcript, {
        audioDurationMs: 30000,
        processedAudioMs: 30000,
        coveredAudioMs: 30000,
        totalUnits: 1,
        completedUnits: 1,
        failedUnits: 0,
        retryCount: 0,
        segmentCount: 1,
        speakerCount: 1,
      });
      return f.host.save({
        ...input,
        transcriptionModel: { id: "qwen3-asr-0.6b-force", name: "Qwen 0.6B + ForcedAligner" },
        transcript,
        transcriptionStats: {
          ...stats,
          totalUnits: 1,
          completedUnits: 1,
          failedUnits: 0,
          pendingUnits: 0,
          processedAudioMs: 30000,
          scheduledSpeechMs: 30000,
          coveredAudioMs: 30000,
          terminationReason: "completed",
          finalResultSaved: true,
        },
      });
    },
  });
  assert.equal(result.transcriptionAssist?.status, "completed");
  assert.equal(
    result.transcriptionVariants?.["qwen3-asr-0.6b-force"]?.transcript[0]?.text,
    "我们集合。",
  );
  assert.equal(isVoiceMemoryRecord(result), true);
  assert.equal(result.transcript[0]?.startMs, 5200);
  assert.equal(
    result.transcriptionVariants?.["siliconflow-sensevoice-small"]?.transcript[0]?.startMs,
    0,
  );
  const context = hybridOrganizationContext(result, { startMs: 5000, endMs: 7000 } as never);
  assert.match(context, /我们集合吧/);
  assert.match(context, /不得虚构说话人/);
  assert.equal(hybridOrganizationContext(result, { startMs: 40000, endMs: 50000 } as never), "");
});

test("resuming an existing Paraformer checkpoint preserves its identity instead of silently changing model", async () => {
  const f = fixture();
  const old = await f.host.save({
    ...f.current,
    transcriptionAssist: {
      status: "running",
      cloudModelId: "siliconflow-sensevoice-small",
      localModelId: "paraformer-zh",
    },
  });
  let selected: string | undefined;
  await assert.rejects(
    assistCloudTranscription(old, {
      ...f.host,
      local: async (input) => {
        selected = input.transcriptionAssist?.localModelId;
        f.controller.abort();
        return input;
      },
    }),
  );
  assert.equal(selected, "paraformer-zh");
});

test("starting local assistance reuses a completed cloud original without re-uploading or probing audio", async () => {
  const f = fixture();
  let localCalls = 0;
  const result = await transcribeWithRemoteProvider({
    record: f.current,
    provider: "cloud",
    ...f.host,
    store: {
      status: async () => ({ cloudConfigured: true }),
      transcribe: async () => assert.fail("must reuse cloud original"),
    } as never,
    updateDiagnostic: async (record) => record,
    assist: async () => {
      localCalls++;
      throw Error("model_qwen3-asr-0.6b-force_runtime_not_ready");
    },
  });
  assert.equal(localCalls, 1);
  assert.equal(result.transcriptionAssist?.localModelId, "qwen3-asr-0.6b-force");
  assert.equal(result.transcriptionModel?.id, "siliconflow-sensevoice-small");
  assert.equal(result.transcript[0]?.id, "cloud-sentence");
});

test("local failure restores cloud output while retaining the local partial result and version", async () => {
  const f = fixture();
  const result = await assistCloudTranscription(f.current, {
    ...f.host,
    local: async (input) => {
      await f.host.save({
        ...input,
        transcriptionVariants: {
          ...input.transcriptionVariants,
          "paraformer-zh": {
            model: { id: "paraformer-zh", name: "local" },
            transcript: [
              {
                id: "partial",
                recordingId: "hybrid",
                startMs: 5000,
                endMs: 6000,
                text: "已保存的本地结果",
              },
            ],
            speakers: [],
            updatedAt: input.updatedAt,
          },
        },
      });
      throw Error("model_paraformer-zh_runtime_not_ready");
    },
  });
  assert.equal(result.transcriptionAssist?.status, "failed");
  assert.equal(result.transcriptionModel?.id, "siliconflow-sensevoice-small");
  assert.equal(result.transcript[0]?.id, "cloud-sentence");
  assert.ok(result.transcriptionVariants?.["paraformer-zh"]?.transcript.length);
});

test("cancellation preserves both transcripts and never publishes a completed assist", async () => {
  const f = fixture();
  await assert.rejects(
    assistCloudTranscription(f.current, {
      ...f.host,
      local: async (input) => {
        f.controller.abort();
        return input;
      },
    }),
  );
  assert.equal(f.current.transcriptionAssist?.status, "running");
  assert.ok(f.current.transcriptionVariants?.["siliconflow-sensevoice-small"]?.transcript.length);
});

test("a shared-store conflict can never restore stale cloud data over the winner", async () => {
  const f = fixture();
  await assert.rejects(
    assistCloudTranscription(f.current, {
      ...f.host,
      local: async (input) => {
        await f.host.save({
          ...input,
          taskId: "newer-owner",
          transcript: [
            {
              ...input.transcriptionVariants!["siliconflow-sensevoice-small"]!.transcript[0]!,
              text: "另外一个新任务保存的结果",
            },
          ],
        });
        throw Error("voice_memory_shared_result_changed");
      },
    }),
    /shared_result_changed/,
  );
  assert.equal(f.current.taskId, "newer-owner");
  assert.equal(f.current.transcript[0]?.text, "另外一个新任务保存的结果");
});

test("pausing during fallback reload cannot publish ready", async () => {
  const f = fixture();
  await assert.rejects(
    assistCloudTranscription(f.current, {
      ...f.host,
      local: async () => {
        throw Error("local_runtime_failed");
      },
      reload: async () => {
        f.controller.abort();
        return f.current;
      },
    }),
  );
  assert.equal(f.current.transcriptionAssist?.status, "running");
});

test("a same-task external edit is protected by its exact revision, not only taskId", async () => {
  const f = fixture();
  await assert.rejects(
    assistCloudTranscription(f.current, {
      ...f.host,
      local: async () => {
        f.foreignSave({
          ...f.current,
          transcript: [{ ...f.current.transcript[0]!, text: "外部修正的新文字" }],
        });
        throw Error("local_runtime_failed");
      },
    }),
    /voice_memory_shared_result_changed/,
  );
  assert.equal(f.current.transcript[0]?.text, "外部修正的新文字");
});
