import assert from "node:assert/strict";
import test from "node:test";
import { generateFusionBatch } from "../src/main/transcript-fusion-generation";
import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";

const rows: VoiceMemoryTranscriptSegment[] = Array.from({ length: 12 }, (_, index) => ({
  id: `local-${index}`,
  recordingId: "synthetic",
  speakerId: "member",
  startMs: index * 1000,
  endMs: index * 1000 + 900,
  text: `合成语句${index}`,
}));
const request = {
  purpose: "organize" as const,
  manual: true,
  maxNewTokens: 6000,
  prompt: `instructions\n本地语句：${JSON.stringify(rows)}\n云端参照：[]`,
};
test("explicit content rejection retains originals without resubmitting smaller pieces", async () => {
  let calls = 0;
  const result = await generateFusionBatch(
    async () => {
      calls++;
      throw Error("custom_ai_content_rejected");
    },
    request,
    rows,
    [],
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    result.segments.map((row) => row.text),
    rows.map((row) => row.text),
  );
  assert.ok(
    result.segments.every(
      (row) => row.reviewReason === "provider_content_rejected" && row.uncertain,
    ),
  );
});
test("invalid provider JSON bisects to bounded three-sentence requests without losing IDs", async () => {
  const counts: number[] = [];
  const result = await generateFusionBatch(
    async (input) => {
      const subset = JSON.parse(
        input.prompt.split("本地语句：")[1]!.split("\n云端参照：")[0]!,
      ) as typeof rows;
      counts.push(subset.length);
      if (subset.length > 3) throw Error("custom_ai_invalid_json");
      return {
        segments: subset.map((row) => ({
          id: row.id,
          text: row.text,
          uncertain: true,
          cloudIds: [],
        })),
      };
    },
    request,
    rows,
    [],
  );
  assert.deepEqual(counts, [12, 6, 3, 3, 6, 3, 3]);
  assert.deepEqual(
    result.segments.map((s) => s.id),
    rows.map((s) => s.id),
  );
});
test("cancellation never launches a smaller request and persistent malformed replies keep marked originals", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    generateFusionBatch(
      async () => {
        calls++;
        controller.abort();
        throw Error("custom_ai_invalid_json");
      },
      { ...request, signal: controller.signal },
      rows,
      [],
    ),
  );
  assert.equal(calls, 1);
  calls = 0;
  const retained = await generateFusionBatch(
    async () => {
      calls++;
      return { segments: [] };
    },
    request,
    rows,
    [],
  );
  assert.equal(calls, 7);
  assert.deepEqual(
    retained.segments.map((row) => row.text),
    rows.map((row) => row.text),
  );
  assert.ok(
    retained.segments.every(
      (row) => row.reviewReason === "provider_invalid_response" && row.uncertain,
    ),
  );
});
