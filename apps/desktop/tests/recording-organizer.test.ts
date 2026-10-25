import assert from "node:assert/strict";
import test from "node:test";

import type { VoiceMemoryRecord, VoiceMemoryTranscriptSegment } from "@private-voice/shared";
import { VoiceMemoryOrganizer } from "../src/main/voice-memory-organizer";
import type { GenerateJsonRequest } from "../src/main/ai-text-gateway";

import {
  materializeOrganizationChunks,
  normalizeOrganizationResult,
  participantSpeakingShares,
  planRecordingOrganizationChunks,
  transcriptForOrganizationChunk,
  organizationFinalPrompt,
  RECORDING_ORGANIZATION_PIPELINE_VERSION,
} from "../src/main/recording-organizer";

test("recap normalization removes generic gaming filler and fabricated quotes while retaining a specific sourced joke", () => {
  const record = longRecord();
  record.transcript = [
    { ...record.transcript[0]!, nickname: "阿甲", text: "我绝对不送，哎我怎么又没了。" },
  ];
  const result = normalizeOrganizationResult(
    {
      description: "朋友间游戏聊天开黑，气氛轻松愉快。",
      summary: [
        { text: "朋友间游戏聊天开黑，气氛轻松愉快。", sourceSegmentIds: ["segment-0"] },
        { text: "阿甲刚说“我绝对不送”，下一句就开始找自己。", sourceSegmentIds: ["segment-0"] },
        { text: "阿甲说“我输了十把”，当场破防。", sourceSegmentIds: ["segment-0"] },
      ],
    },
    record,
  );
  assert.equal(result.summary.length, 1);
  assert.match(result.summary[0]!.text, /我绝对不送/);
  assert.doesNotMatch(result.description, /气氛轻松愉快/);
  assert.deepEqual(result.summary[0]!.sourceSegmentIds, ["segment-0"]);
});

test("recap evidence owns speaker names and jump times instead of provider guesses", () => {
  const record = longRecord();
  record.transcript = [
    { ...record.transcript[0]!, nickname: undefined, startMs: 5200, text: "我绝对不送。" },
  ];
  const result = normalizeOrganizationResult(
    {
      participants: [{ speakerId: "member-a", nickname: "凭空编造的阿强" }],
      summary: [
        {
          text: "“我绝对不送”这句保证可以回听核对。",
          sourceStartMs: 1,
          sourceSegmentIds: ["segment-0"],
        },
      ],
      funnyMoments: [
        {
          title: "一句保证",
          description: "“我绝对不送”",
          sourceSegmentIds: ["segment-0"],
          speakerIds: ["invented-person"],
        },
      ],
    },
    record,
  );
  assert.equal(result.participants[0]?.nickname, undefined);
  assert.equal(result.summary[0]?.sourceStartMs, 5200);
  assert.ok(!result.funnyMoments[0]?.speakerIds.includes("invented-person"));
});

test("generic provider filler consumes a bounded repair attempt instead of being published as a successful recap", async () => {
  const record = longRecord();
  record.transcript = [{ ...record.transcript[0]!, text: "我绝对不送，哎我怎么又没了。" }];
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async () => ({
        value:
          ++calls === 1
            ? {
                description: "朋友间游戏聊天开黑，气氛轻松愉快。",
                summary: [{ text: "朋友间游戏聊天开黑，气氛轻松愉快。" }],
              }
            : {
                description: "Sober一句保证刚落地，就开始寻找自己。",
                summary: [
                  {
                    text: "Sober刚说“我绝对不送”，紧接着问自己怎么没了。",
                    sourceSegmentIds: ["segment-0"],
                  },
                ],
              },
      }),
    } as never,
    async (value) => value,
  );
  const result = await organizer.organize(record, true, new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(result.organization?.status, "completed");
  assert.match(result.summary[0]!.text, /我绝对不送/);
  assert.doesNotMatch(result.summary[0]!.text, /轻松愉快/);
});

test("a new recap pipeline regenerates old completed and exhausted blocks without destroying the saved overview first", async () => {
  const initial = longRecord();
  initial.transcript = initial.transcript.slice(0, 1);
  const old = "朋友间游戏聊天开黑，气氛轻松愉快。";
  const seed = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async () => ({ value: { description: "旧版概览" } }),
    } as never,
    async (record) => record,
  );
  const previous = await seed.organize(initial, true, new AbortController().signal);
  previous.summary = [{ text: old }];
  previous.organization!.pipelineVersion = RECORDING_ORGANIZATION_PIPELINE_VERSION - 1;
  previous.organization!.chunks = previous.organization!.chunks.map((chunk) => ({
    ...chunk,
    attempts: 6,
    status: "completed",
  }));
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async () => {
        calls++;
        return { value: { description: "Sober谈到了第1段的内容。" } };
      },
    } as never,
    async (record) => {
      if (record.organization?.status === "running") {
        assert.equal(record.summary[0]?.text, old);
        assert.equal(record.organization.finalResult?.description, "旧版概览");
      }
      return record;
    },
  );
  const next = await organizer.organize(previous, true, new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(next.organization?.status, "completed");
});

test("chunk participants and references stay inside that chunk and reduction stays compact", () => {
  const record = longRecord();
  record.transcript = Array.from({ length: 458 }, (_, i) => ({
    ...transcriptSegment(i, i * 20000),
    id: `long-recording-identity-${i}-${"x".repeat(45)}`,
  }));
  const chunkRecord = { ...record, transcript: record.transcript.slice(0, 66) };
  const result = normalizeOrganizationResult({ description: "按录音整理" }, chunkRecord);
  assert.equal(result.participants.flatMap((p) => p.sourceSegmentIds).length, 66);
  const legacy = normalizeOrganizationResult({ description: "已有分块" }, record);
  const prompt = organizationFinalPrompt(record, [legacy, legacy]);
  assert.ok(prompt.length < 4000, `participant references bloated prompt to ${prompt.length}`);
  assert.equal(legacy.participants.flatMap((p) => p.sourceSegmentIds).length, 458);
});

test("empty reduction fails without publishing an empty summary or losing completed chunks", async () => {
  let saved = longRecord();
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async (request: GenerateJsonRequest) => ({
        value: request.prompt.includes("把多个连续分块") ? {} : { description: "有效的分块内容。" },
      }),
    } as never,
    async (value) => (saved = value),
  );
  await assert.rejects(
    organizer.organize(saved, true, new AbortController().signal),
    /organization_empty_result/,
  );
  assert.ok(saved.organization?.chunks.every((chunk) => chunk.status === "completed"));
  assert.equal(saved.organization?.finalResult, undefined);
  assert.equal(saved.organization?.status, "failed");
});

test("legacy empty completed reductions are retried without repeating successful transcript chunks", async () => {
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async () => {
        calls++;
        return { value: { description: "有效摘要", summary: [{ text: "依据原文整理" }] } };
      },
    } as never,
    async (record) => record,
  );
  const first = await organizer.organize(longRecord(), true, new AbortController().signal);
  calls = 0;
  const empty = normalizeOrganizationResult({}, longRecord());
  const reductions = Object.fromEntries(
    Object.entries(first.organization!.reductionRetries ?? {}).map(([key, value]) => [
      key,
      { ...value, value: empty },
    ]),
  );
  const repaired = await organizer.organize(
    { ...first, organization: { ...first.organization!, reductionRetries: reductions } },
    true,
    new AbortController().signal,
  );
  assert.ok(calls > 0, "cached empty reductions must not be mistaken for completed summaries");
  assert.ok(calls < first.organization!.chunks.length, "successful chunks must be reused");
  assert.equal(repaired.organization?.status, "completed");
  assert.ok(repaired.summary.length);
});

test("completed fusion is the summary source while every persisted main transcript stays original", async () => {
  const initial = longRecord();
  initial.transcript = initial.transcript.slice(0, 1);
  const original = JSON.stringify(initial.transcript);
  const fused = [
    { ...initial.transcript[0]!, text: "融合更正后的合成原句。", words: undefined },
    {
      ...initial.transcript[0]!,
      id: "fusion-cloud:extra",
      text: "仅云端存在的合成内容。",
      startMs: 100000,
      endMs: 105000,
      fusionEstimated: true,
      fusionUncertain: true,
    },
  ];
  initial.transcriptionAssist = {
    status: "completed",
    cloudModelId: "siliconflow-sensevoice-small",
    localModelId: "qwen3-asr-0.6b-force",
  };
  initial.transcriptionFusion = {
    status: "completed",
    sourceSignature: "a".repeat(64),
    completedBatches: 1,
    totalBatches: 1,
    transcript: fused,
    speakers: [],
  };
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async (request: GenerateJsonRequest) => {
        calls++;
        assert.ok(request.prompt.includes("sourceSegmentIds=fusion-cloud:extra"));
        return {
          value: {
            description: "实际融合来源摘要",
            summary: [
              {
                text: "云端独有的内容。",
                sourceStartMs: 100000,
                sourceSegmentIds: ["fusion-cloud:extra"],
              },
            ],
          },
        };
      },
    } as never,
    async (record) => {
      assert.equal(JSON.stringify(record.transcript), original);
      return { ...record, updatedAt: "2026-10-23T12:00:00.000Z" };
    },
  );
  const result = await organizer.organize(initial, true, new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result.transcript), original);
  assert.deepEqual(result.summary[0]?.sourceSegmentIds, ["fusion-cloud:extra"]);
  assert.equal(result.updatedAt, "2026-10-23T12:00:00.000Z");
});

test("source signatures survive serialization and property ordering without repeating completed chunks", async () => {
  const initial = longRecord();
  initial.transcript = initial.transcript.slice(0, 1);
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async () => {
        calls++;
        return { value: { description: "有效摘要" } };
      },
    } as never,
    async (record) => record,
  );
  const first = await organizer.organize(initial, true, new AbortController().signal);
  const restored = JSON.parse(JSON.stringify(first)) as VoiceMemoryRecord;
  restored.transcript = restored.transcript.map(
    (segment) =>
      Object.fromEntries(
        Object.entries(segment).reverse(),
      ) as unknown as VoiceMemoryTranscriptSegment,
  );
  calls = 0;
  await organizer.organize(restored, true, new AbortController().signal);
  assert.equal(calls, 0);
});

test("a corrected sentence invalidates its cached summary despite unchanged identity and timing", async () => {
  const initial = longRecord();
  initial.transcript = initial.transcript.slice(0, 1);
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async (request: GenerateJsonRequest) => {
        calls++;
        return {
          value: {
            description: request.prompt.includes("更正后的合成原文") ? "更正后的摘要" : "原文摘要",
          },
        };
      },
    } as never,
    async (record) => record,
  );
  const first = await organizer.organize(initial, true, new AbortController().signal);
  calls = 0;
  await organizer.organize(first, true, new AbortController().signal);
  assert.equal(calls, 0, "identical input must still reuse completed work");
  const corrected = {
    ...first,
    transcript: first.transcript.map((segment) => ({
      ...segment,
      text: "更正后的合成原文，时间与句子身份保持相同。",
      words: undefined,
    })),
  };
  const next = await organizer.organize(corrected, true, new AbortController().signal);
  assert.equal(calls, 1, "same IDs cannot authorize a summary of stale wording");
  assert.equal(next.organization?.finalResult?.description, "更正后的摘要");
});

const transcriptSegment = (
  index: number,
  startMs: number,
  speakerId = index % 2 === 0 ? "member-a" : "member-b",
): VoiceMemoryTranscriptSegment => ({
  id: `segment-${index}`,
  recordingId: "long-recording",
  startMs,
  endMs: startMs + (speakerId === "member-a" ? 40_000 : 20_000),
  text: `这是第${index + 1}段真实的朋友游戏聊天内容，不应被遗漏或重复。`,
  speakerId,
  nickname: speakerId === "member-a" ? "Sober" : "朋友",
  confidence: "high",
});

const longRecord = (): VoiceMemoryRecord => {
  const transcript = Array.from({ length: 55 }, (_, index) =>
    transcriptSegment(index, index * 10 * 60_000),
  );
  return {
    schemaVersion: 1,
    recordingId: "long-recording",
    filePath: "C:\\recordings\\long-recording.m4a",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    phase: "ready",
    progress: 100,
    speakers: [],
    transcript,
    summary: [],
    chapters: [],
    highlights: [],
    markerTitles: [],
    timeline: [],
  };
};

test("room cloud and custom organization retain every chunk and produce upload-ready results", async () => {
  for (const provider of ["cloud", "custom"] as const) {
    const source = { ...longRecord(), roomId: `room_${"a".repeat(32)}` };
    const requests: Array<{ roomId?: string; provider?: string; prompt: string }> = [];
    const organizer = new VoiceMemoryOrganizer(
      {
        usesLocalOrganizer: () => false,
        organizerProvider: () => provider,
        generateJsonWithMetrics: async (request: GenerateJsonRequest) => {
          requests.push(request);
          return {
            value: { description: "朋友一起玩游戏。", summary: [{ text: "按原录音整理。" }] },
          };
        },
      } as never,
      async (record) => record,
    );
    const result = await organizer.organize(source, false, new AbortController().signal);
    assert.equal(result.organization?.status, "completed");
    assert.equal(result.organization?.modelId, provider);
    assert.equal(result.organization?.metrics, undefined);
    assert.ok(result.organization?.finalResult?.summary.length);
    assert.equal(
      result.organization?.chunks.flatMap((chunk) => chunk.sourceSegmentIds).length,
      source.transcript.length,
    );
    assert.ok(
      requests.every(
        (request) => request.roomId === source.roomId && request.provider === provider,
      ),
    );
    for (const segment of source.transcript)
      assert.ok(requests.some((request) => request.prompt.includes(segment.id)));
  }
});

test("empty remote replies cannot become completed summaries", async () => {
  let saved = longRecord();
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => false,
      generateJsonWithMetrics: async () => ({ value: {} }),
    } as never,
    async (value) => (saved = value),
  );
  await assert.rejects(
    organizer.organize(saved, false, new AbortController().signal),
    /organization_empty_result/,
  );
  assert.equal(saved.organization?.status, "failed");
  assert.equal(saved.organization?.finalResult, undefined);
});

test("local organization runs chunk and reduction phases and resumes completed chunks", async () => {
  const source = longRecord();
  let calls = 0;
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => true,
      generateJson: async () => {
        throw new Error("unexpected_single_pass");
      },
      generateJsonWithMetrics: async () => {
        calls++;
        return {
          value: {
            summary: [{ text: "一起玩游戏", sourceStartMs: 0 }],
            topics: [],
            highlights: [],
            funnyMoments: [],
            participants: [],
            todos: [],
          },
          metrics: undefined,
        };
      },
    } as never,
    async (value) => value,
  );
  const organized = await organizer.organize(source, false, new AbortController().signal);
  assert.equal(organized.organization?.status, "completed");
  const chunks = organized.organization!.chunks;
  assert.ok(chunks.length > 1);
  assert.ok(calls > chunks.length, "multiple chunk results must go through reduction");
  assert.ok(chunks.every((chunk) => chunk.status === "completed"));
  assert.equal(organized.summary[0]?.text, "一起玩游戏");
  calls = 0;
  const resumed = await organizer.organize(
    {
      ...organized,
      organization: {
        ...organized.organization!,
        status: "paused",
        chunks: chunks.map((chunk, index) =>
          index === 0 ? { ...chunk, status: "pending", result: undefined } : chunk,
        ),
      },
    },
    false,
    new AbortController().signal,
  );
  assert.equal(resumed.organization?.status, "completed");
  assert.ok(calls < chunks.length, "completed chunks must not be inferred again");
});

test("local organization does not publish a late result after cancellation", async () => {
  const controller = new AbortController();
  let saved = longRecord();
  const organizer = new VoiceMemoryOrganizer(
    {
      usesLocalOrganizer: () => true,
      generateJsonWithMetrics: async () => {
        controller.abort();
        return { value: {}, metrics: undefined };
      },
    } as never,
    async (value) => {
      saved = value;
      return value;
    },
  );
  await assert.rejects(organizer.organize(saved, false, controller.signal), /ai_task_paused/);
  assert.equal(saved.phase, "paused");
  assert.equal(saved.organization?.status, "paused");
  assert.ok(saved.organization!.chunks.every((chunk) => chunk.status !== "completed"));
});

test("long recording organization chunks cover every reliable segment exactly once", () => {
  const record = longRecord();
  const plans = planRecordingOrganizationChunks(record);
  assert.ok(plans.length >= 8, "nine-hour transcript should be split into multiple chunks");
  const ids = plans.flatMap((plan) => plan.sourceSegmentIds);
  assert.equal(ids.length, record.transcript.length);
  assert.deepEqual(
    ids,
    record.transcript.map((segment) => segment.id),
  );
  assert.equal(new Set(ids).size, ids.length);
  for (let index = 1; index < plans.length; index += 1) {
    assert.ok((plans[index]?.startMs ?? 0) > (plans[index - 1]?.endMs ?? 0));
  }
});

test("busy recordings split below the real 8GB FreeToken KV limit", () => {
  const record = longRecord();
  record.transcript = Array.from({ length: 180 }, (_, index) => ({
    ...transcriptSegment(index, index * 60_000),
    text: `第${index + 1}段` + "这是一段持续讲话的开黑语音内容".repeat(14),
  }));
  const plans = planRecordingOrganizationChunks(record);
  assert.ok(plans.length > 8);
  assert.ok(
    plans.length < record.transcript.length / 2,
    "natural-boundary scoring must not regress into one tiny chunk per transcript segment",
  );
  assert.ok(
    plans.every((plan) => plan.estimatedInputTokens <= 3_200),
    "dense input plus a complete structured answer must fit the measured 8,218-token KV pool",
  );
});

test("completed organization chunks survive restart while running chunks become pending", () => {
  const plans = planRecordingOrganizationChunks(longRecord()).slice(0, 2);
  const initial = materializeOrganizationChunks(plans, undefined);
  const restored = materializeOrganizationChunks(plans, [
    { ...initial[0]!, status: "completed", result: normalizeOrganizationResult({}, longRecord()) },
    { ...initial[1]!, status: "running" },
  ]);
  assert.equal(restored[0]?.status, "completed");
  assert.equal(restored[1]?.status, "pending");
});

test("speaker speaking share is calculated from real transcript duration", () => {
  const shares = participantSpeakingShares(longRecord());
  assert.equal(shares.length, 2);
  assert.equal(
    Number(shares.reduce((sum, item) => sum + (item.speakingSharePercent ?? 0), 0).toFixed(1)),
    100,
  );
  assert.ok((shares[0]?.speakingSharePercent ?? 0) > (shares[1]?.speakingSharePercent ?? 0));
  assert.equal(shares[0]?.nickname, "Sober");
});

test("organization input uses readable dialogue paragraphs without word-level timing noise", () => {
  const record = longRecord();
  record.transcript = Array.from({ length: 6 }, (_, index) => ({
    ...transcriptSegment(index, 21 * 60_000 + index * 2_200, "member-a"),
    endMs: 21 * 60_000 + index * 2_200 + 1_700,
    text: [
      "我觉得可以。",
      "但是先等等。",
      "你先把墙补一下。",
      "然后我们再出去。",
      "这波别急。",
      "看我位置。",
    ][index]!,
    words: [
      {
        id: `word-${index}`,
        startMs: 21 * 60_000 + index * 2_200,
        endMs: 21 * 60_000 + index * 2_200 + 1_700,
        text: `词${index}`,
      },
    ],
  }));

  const input = transcriptForOrganizationChunk(record, {
    sourceSegmentIds: record.transcript.map((segment) => segment.id),
  });
  const lines = input.split("\n");

  assert.ok(lines.length >= 1 && lines.length <= 3);
  assert.match(input, /^\[21:00｜Sober｜speakerId=member-a｜sourceSegmentIds=segment-0,/);
  assert.match(input, /我觉得可以。/);
  assert.match(input, /然后我们再出去。/);
  assert.doesNotMatch(input, /startMs=|endMs=|word-\d/);
  for (const segment of record.transcript) assert.match(input, new RegExp(segment.id));
});
