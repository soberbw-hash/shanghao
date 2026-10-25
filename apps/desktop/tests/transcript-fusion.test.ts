import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { fuseTranscripts, processTranscriptFusion } from "../src/main/transcript-fusion";
import { resolveTranscriptView } from "../src/renderer/src/features/ai/transcriptView";
import type { VoiceMemoryRecord } from "@private-voice/shared";
import { voiceMemoryResumeRequest } from "../src/main/voice-memory-resume";
import { isVoiceMemoryRecord } from "../src/main/voice-memory-store";
import {
  assignVoiceMemorySpeaker,
  migrateVoiceMemoryIdentity,
} from "../src/main/voice-memory-identity";

function fixture() {
  const segment = {
    id: "local-1",
    recordingId: "r",
    startMs: 5200,
    endMs: 6800,
    text: "我们去下陆。",
    speakerId: "member-a",
    confidence: "high" as const,
    words: [{ id: "word", text: "下陆", startMs: 6000, endMs: 6500 }],
  };
  const cloud = {
    ...segment,
    id: "cloud-1",
    startMs: 0,
    endMs: 20000,
    text: "我们去下路。",
    words: undefined,
  };
  const record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord({
      recordingId: "r",
      filePath: "fixture.wav",
      roomId: "room-a",
    }),
    transcriptionModel: { id: "qwen3-asr-0.6b-force", name: "Qwen" },
    transcript: [segment],
    transcriptionAssist: {
      status: "completed",
      cloudModelId: "siliconflow-sensevoice-small",
      localModelId: "qwen3-asr-0.6b-force",
    },
    transcriptionVariants: {
      "siliconflow-sensevoice-small": {
        model: { id: "siliconflow-sensevoice-small", name: "SenseVoice" },
        transcript: [cloud],
        speakers: [],
        updatedAt: "2026-10-21",
      },
      "qwen3-asr-0.6b-force": {
        model: { id: "qwen3-asr-0.6b-force", name: "Qwen" },
        transcript: [segment],
        speakers: [],
        updatedAt: "2026-10-21",
      },
    },
  };
  let current = record;
  const saves: VoiceMemoryRecord[] = [];
  const controller = new AbortController();
  return {
    record,
    saves,
    controller,
    get current() {
      return current;
    },
    host: {
      signal: controller.signal,
      manual: true,
      save: async (value: VoiceMemoryRecord) => {
        current = value;
        saves.push(value);
        return value;
      },
    },
  };
}

test("unreviewed originals retry only on an explicit request and can clear their review marker", async () => {
  const f = fixture();
  const first = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => {
      throw Error("custom_ai_content_rejected");
    },
  });
  assert.equal(first.transcriptionFusion?.status, "failed");
  assert.equal(first.transcriptionFusion?.errorCode, "fusion_unreviewed");
  assert.equal(
    first.transcriptionFusion?.transcript.find((s) => s.id === "local-1")?.fusionReviewReason,
    "provider_content_rejected",
  );
  let calls = 0;
  const host = {
    ...f.host,
    generate: async () => {
      calls++;
      return {
        segments: [
          { id: "local-1", text: "我们去下路。", uncertain: false, cloudIds: ["cloud-1"] },
        ],
      };
    },
  };
  await fuseTranscripts(first, host);
  assert.equal(calls, 0);
  const next = await fuseTranscripts(first, { ...host, retryUnreviewed: true });
  assert.equal(calls, 1);
  assert.equal(next.transcriptionFusion?.transcript[0]?.text, "我们去下路。");
  assert.equal(next.transcriptionFusion?.transcript[0]?.fusionReviewReason, undefined);
  assert.deepEqual(next.transcriptionVariants, first.transcriptionVariants);
});

test("organizing persisted cloud and local originals also starts missing fusion without another ASR run", async () => {
  const f = fixture();
  const original = JSON.stringify(f.record.transcriptionVariants);
  const result = await processTranscriptFusion(
    f.record,
    { recordingId: "r", filePath: "fixture.wav", manual: true, transcribe: false, organize: true },
    {
      generateJson: async () => ({
        segments: [
          { id: "local-1", text: "我们去下路。", uncertain: false, cloudIds: ["cloud-1"] },
        ],
      }),
    } as never,
    f.host.save,
    f.controller.signal,
    () => {},
  );
  assert.equal(result.transcriptionFusion?.status, "completed");
  assert.equal(result.transcriptionFusion?.transcript[0]?.text, "我们去下路。");
  assert.equal(JSON.stringify(result.transcriptionVariants), original);
});

test("resuming a saved complete transcript does not request audio transcription again", () => {
  const f = fixture();
  const cloud = f.record.transcriptionVariants!["siliconflow-sensevoice-small"]!;
  const record = {
    ...f.record,
    transcript: cloud.transcript,
    transcriptionModel: cloud.model,
    phase: "ready" as const,
    taskStatus: "success" as const,
    processingStage: "storage" as const,
    transcriptionElapsedMs: 100,
  };
  assert.equal(voiceMemoryResumeRequest(record).transcribe, false);
});

test("an actually reviewed identical transcript is valid without inventing wording changes", async () => {
  const f = fixture();
  f.record.transcriptionVariants!["siliconflow-sensevoice-small"]!.transcript[0]!.text =
    "我们去下陆。";
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => ({
      segments: [{ id: "local-1", text: "我们去下陆。", uncertain: false, cloudIds: ["cloud-1"] }],
    }),
  });
  assert.equal(result.transcriptionFusion?.status, "completed");
  assert.equal(result.transcriptionFusion?.transcript[0]?.text, f.record.transcript[0]?.text);
  assert.equal(result.transcriptionFusion?.transcript[0]?.fusionUncertain, false);
});

test("a legacy completed assist missing its local original cannot advertise completed fusion", async () => {
  const f = fixture();
  delete f.record.transcriptionVariants!["qwen3-asr-0.6b-force"];
  const result = await processTranscriptFusion(
    f.record,
    { recordingId: "r", filePath: "fixture.wav", transcribe: false, organize: true },
    {
      generateJson: async () => assert.fail("missing originals cannot be sent as a fusion"),
    } as never,
    f.host.save,
    f.controller.signal,
    () => {},
  );
  assert.equal(result.transcriptionAssist?.status, "failed");
  assert.equal(result.transcriptionAssist?.errorCode, "hybrid_local_original_missing");
  assert.notEqual(result.transcriptionFusion?.status, "completed");
});

test("fusion corrects wording with both sources, retains timing and identity, and never overwrites originals", async () => {
  const f = fixture();
  const originals = JSON.stringify(f.record.transcriptionVariants);
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async (request) => {
      assert.equal(request.roomId, "room-a");
      assert.match(request.prompt, /我们去下陆/);
      assert.match(request.prompt, /我们去下路/);
      return {
        segments: [
          { id: "local-1", text: "我们去下路。", uncertain: false, cloudIds: ["cloud-1"] },
        ],
      };
    },
  });
  assert.equal(result.transcriptionFusion?.status, "completed");
  assert.equal(isVoiceMemoryRecord(result), true);
  assert.equal(JSON.stringify(result.transcriptionVariants), originals);
  assert.equal(result.transcript[0]?.text, "我们去下陆。");
  const view = resolveTranscriptView(result);
  assert.equal(view?.kind, "fusion");
  assert.equal(view?.transcript[0]?.text, "我们去下路。");
  assert.equal(view?.transcript[0]?.startMs, 5200);
  assert.equal(view?.transcript[0]?.speakerId, "member-a");
  assert.equal(
    view?.transcript[0]?.words,
    undefined,
    "changed words must not reuse old word alignment",
  );
  assert.equal(resolveTranscriptView(result, "cloud")?.transcript[0]?.startMs, 0);
  assert.equal(resolveTranscriptView(result, "local")?.transcript[0]?.text, "我们去下陆。");
  const assigned = assignVoiceMemorySpeaker(result, "member-a", "confirmed-member", "已确认昵称");
  assert.equal(resolveTranscriptView(assigned)?.transcript[0]?.nickname, "已确认昵称");
  assert.equal(resolveTranscriptView(assigned)?.transcript[0]?.text, "我们去下路。");
  assert.equal(resolveTranscriptView(assigned)?.transcript[0]?.startMs, 5200);
  assert.equal(
    assigned.transcriptionVariants?.["qwen3-asr-0.6b-force"]?.transcript[0]?.memberId,
    "confirmed-member",
  );
  assert.equal(
    assigned.transcriptionVariants?.["siliconflow-sensevoice-small"]?.transcript[0]?.memberId,
    undefined,
    "separate recognizers' anonymous IDs cannot establish the same person",
  );
  const migrated = migrateVoiceMemoryIdentity(assigned, "stable-r", "stable.wav");
  assert.ok(
    Object.values(migrated.transcriptionVariants ?? {}).every((v) =>
      v!.transcript.every((s) => s.recordingId === "stable-r"),
    ),
  );
  assert.ok(migrated.transcriptionFusion?.transcript.every((s) => s.recordingId === "stable-r"));
  const reused = await fuseTranscripts(migrated, {
    ...f.host,
    generate: async () =>
      assert.fail("trusted metadata migration must preserve completed correction"),
  });
  assert.equal(reused.transcriptionFusion?.status, "completed");
});

test("fusion tells the provider the exact cloud references allowed for each local sentence", async () => {
  const f = fixture();
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async (request) => {
      const rows = JSON.parse(request.prompt.split("本地语句：")[1]!.split("\n云端参照：")[0]!);
      assert.deepEqual(rows[0].allowedCloudIds, ["cloud-1"]);
      return { segments: [{ id: "local-1", text: "我们去下陆。", uncertain: true, cloudIds: [] }] };
    },
  });
  assert.equal(result.transcriptionFusion?.status, "failed");
  assert.equal(result.transcriptionFusion?.errorCode, "fusion_unreviewed");
});

test("invalid or invented source IDs retain the original sentence with an explicit unreviewed marker", async () => {
  const f = fixture();
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => ({
      segments: [{ id: "invented", text: "编造句子", uncertain: false, cloudIds: ["other-room"] }],
    }),
  });
  assert.equal(result.transcriptionFusion?.status, "failed");
  const segment = result.transcriptionFusion?.transcript.find((row) => row.id === "local-1");
  assert.equal(segment?.text, "我们去下陆。");
  assert.equal(segment?.startMs, 5200);
  assert.equal(segment?.fusionReviewReason, "provider_invalid_response");
  assert.equal(segment?.fusionUncertain, true);
  assert.equal(resolveTranscriptView(result)?.kind, "cloud");
  assert.ok(
    !result.transcriptionFusion?.transcript.some(
      (row) => row.id === "invented" || row.text === "编造句子",
    ),
  );
  assert.deepEqual(result.transcript, f.record.transcript);
});

test("ambiguous changes retain the original local text and flag uncertainty", async () => {
  const f = fixture();
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => ({
      segments: [{ id: "local-1", text: "我们去上路。", uncertain: true, cloudIds: ["cloud-1"] }],
    }),
  });
  assert.equal(
    result.transcriptionFusion?.transcript.find((s) => s.id === "local-1")?.text,
    "我们去下陆。",
  );
  assert.equal(
    result.transcriptionFusion?.transcript.find((s) => s.id === "local-1")?.fusionUncertain,
    true,
  );
});

test("reconfirming a cloud speaker keeps its stable namespace and cannot rename a local speaker", async () => {
  const f = fixture();
  const cloud = f.record.transcriptionVariants!["siliconflow-sensevoice-small"]!;
  cloud.transcript[0]!.text = "我们去下路。另外还有一句话。";
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => ({
      segments: [{ id: "local-1", text: "我们去下路。", uncertain: false, cloudIds: ["cloud-1"] }],
    }),
  });
  const cloudActive = { ...result, transcriptionModel: cloud.model, transcript: cloud.transcript };
  const first = assignVoiceMemorySpeaker(cloudActive, "member-a", "confirmed-a", "第一次确认");
  const second = assignVoiceMemorySpeaker(first, "member-a", "confirmed-b", "更正后的名字");
  const localRow = second.transcriptionFusion!.transcript.find((s) => !s.fusionEstimated)!;
  const cloudRow = second.transcriptionFusion!.transcript.find((s) => s.fusionEstimated)!;
  assert.equal(localRow.memberId, undefined);
  assert.equal(localRow.nickname, undefined);
  assert.equal(cloudRow.memberId, "confirmed-b");
  assert.equal(cloudRow.nickname, "更正后的名字");
  assert.equal(cloudRow.speakerId, "fusion-cloud:member-a");
});

test("abort and stale ownership errors never publish late fused text", async () => {
  const f = fixture();
  await assert.rejects(
    fuseTranscripts(f.record, {
      ...f.host,
      generate: async () => {
        f.controller.abort();
        return { segments: [] };
      },
    }),
    /abort/i,
  );
  assert.equal(f.current.transcriptionFusion?.completedBatches, 0);
  const g = fixture();
  await assert.rejects(
    fuseTranscripts(g.record, {
      ...g.host,
      save: async () => {
        throw Error("voice_memory_shared_result_changed");
      },
      generate: async () => assert.fail(),
    }),
    /shared_result_changed/,
  );
});

test("completed batches survive a later failure and resume without another ASR run", async () => {
  const f = fixture();
  const local = f.record.transcriptionVariants!["qwen3-asr-0.6b-force"]!;
  local.transcript = Array.from({ length: 13 }, (_, i) => ({
    ...f.record.transcript[0]!,
    id: `local-${i}`,
    text: "我们去下路。",
  }));
  const reply = (request: { prompt: string }) => ({
    segments: JSON.parse(request.prompt.match(/本地语句：(.*)\n/)![1]!).map(
      (row: { id: string; text: string }) => ({
        id: row.id,
        text: row.text,
        uncertain: false,
        cloudIds: ["cloud-1"],
      }),
    ),
  });
  let calls = 0;
  const partial = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async (request) => {
      if (++calls === 2) throw Error("provider_down");
      return reply(request);
    },
  });
  assert.equal(partial.transcriptionFusion?.completedBatches, 1);
  assert.equal(partial.transcriptionFusion?.status, "failed");
  let resumedCalls = 0;
  const result = await fuseTranscripts(partial, {
    ...f.host,
    generate: async (request) => {
      resumedCalls++;
      return reply(request);
    },
  });
  assert.equal(resumedCalls, 1);
  assert.equal(result.transcriptionFusion?.completedBatches, 2);
  assert.equal(result.transcriptionFusion?.status, "completed");
  const paused = {
    ...result,
    phase: "paused" as const,
    transcriptionFusion: { ...result.transcriptionFusion!, status: "running" as const },
  };
  const request = voiceMemoryResumeRequest(paused);
  assert.equal(request.transcribe, false);
  assert.equal(request.fuse, true);
});

test("cloud-only speech is retained with an estimated-time and uncertainty marker", async () => {
  const f = fixture();
  f.record.transcriptionVariants!["siliconflow-sensevoice-small"]!.transcript.push({
    ...f.record.transcript[0]!,
    id: "cloud-only",
    startMs: 40000,
    endMs: 50000,
    text: "本地漏掉的话。",
  });
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => ({
      segments: [{ id: "local-1", text: "我们去下路。", uncertain: false, cloudIds: ["cloud-1"] }],
    }),
  });
  const extra = result.transcriptionFusion?.transcript.find((s) => s.text === "本地漏掉的话。");
  assert.equal(extra?.fusionEstimated, true);
  assert.equal(extra?.fusionUncertain, true);
  assert.equal(extra?.startMs, 40000);
});

test("partial time overlap cannot discard the unmatched remainder of a cloud sentence", async () => {
  const f = fixture();
  f.record.transcript[0]!.text = "先等我回来。";
  f.record.transcriptionVariants!["siliconflow-sensevoice-small"]!.transcript[0]!.text =
    "先等我回来。钥匙放在门口。";
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => ({
      segments: [{ id: "local-1", text: "先等我回来。", uncertain: false, cloudIds: ["cloud-1"] }],
    }),
  });
  assert.ok(result.transcriptionFusion?.transcript.some((s) => s.text.includes("钥匙放在门口")));
  assert.equal(
    result.transcriptionFusion?.transcript.filter((s) => s.text.includes("先等我回来")).length,
    1,
  );
});

test("a shortened cloud substring cannot replace and delete a complete local sentence", async () => {
  const f = fixture();
  f.record.transcript[0]!.text = "钥匙放在门口，回来记得带上。";
  f.record.transcriptionVariants!["siliconflow-sensevoice-small"]!.transcript[0]!.text =
    f.record.transcript[0]!.text;
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => ({
      segments: [{ id: "local-1", text: "钥匙", uncertain: false, cloudIds: ["cloud-1"] }],
    }),
  });
  assert.equal(result.transcriptionFusion?.transcript[0]?.text, f.record.transcript[0]!.text);
  assert.equal(result.transcriptionFusion?.transcript[0]?.fusionUncertain, true);
});

test("oversized references make safe progress with originals retained rather than retrying forever", async () => {
  const f = fixture();
  const long = "参照录音中的完整文字。".repeat(3000);
  f.record.transcriptionVariants!["siliconflow-sensevoice-small"]!.transcript[0]!.text = long;
  const result = await fuseTranscripts(f.record, {
    ...f.host,
    generate: async () => assert.fail("oversized prompt must not be sent"),
  });
  assert.equal(result.transcriptionFusion?.status, "failed");
  assert.equal(result.transcriptionFusion?.errorCode, "fusion_unreviewed");
  assert.equal(result.transcriptionFusion?.completedBatches, 1);
  assert.ok(
    result.transcriptionFusion?.transcript.some((s) => s.text === long && s.fusionEstimated),
  );
  assert.ok(result.transcriptionFusion?.transcript.every((s) => s.fusionUncertain));
});
