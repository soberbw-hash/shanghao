import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";
import type { GenerateJsonRequest } from "./ai-text-gateway";
import { fusionSegmentsOverlap as overlaps } from "./transcript-fusion-coverage";

interface Reply {
  segments: Array<{
    id: string;
    text: string;
    uncertain: boolean;
    cloudIds: string[];
    reviewReason?: VoiceMemoryTranscriptSegment["fusionReviewReason"];
  }>;
}
/** Bound repair work to 12 -> 6 -> 3 sentences; never weaken identity/time validation. */
export async function generateFusionBatch(
  generate: (request: GenerateJsonRequest) => Promise<unknown>,
  request: GenerateJsonRequest,
  rows: VoiceMemoryTranscriptSegment[],
  references: VoiceMemoryTranscriptSegment[],
): Promise<Reply> {
  request.signal?.throwIfAborted();
  try {
    const reply = (await generate(request)) as Reply;
    request.signal?.throwIfAborted();
    if (
      !Array.isArray(reply?.segments) ||
      reply.segments.length !== rows.length ||
      new Set(reply.segments.map((s) => s?.id)).size !== rows.length
    )
      throw Error("fusion_invalid_response");
    for (const row of rows) {
      const value = reply.segments.find((s) => s?.id === row.id);
      if (
        !value ||
        typeof value.text !== "string" ||
        !value.text.trim() ||
        typeof value.uncertain !== "boolean" ||
        !Array.isArray(value.cloudIds) ||
        value.cloudIds.some(
          (id) =>
            typeof id !== "string" || !references.some((c) => c.id === id && overlaps(row, c)),
        )
      )
        throw Error("fusion_invalid_response");
    }
    return {
      segments: reply.segments.map(({ id, text, uncertain, cloudIds }) => ({
        id,
        text,
        uncertain,
        cloudIds,
      })),
    };
  } catch (error) {
    request.signal?.throwIfAborted();
    if (error instanceof Error && error.message === "custom_ai_content_rejected")
      return {
        segments: rows.map((row) => ({
          id: row.id,
          text: row.text,
          uncertain: true,
          cloudIds: [],
          reviewReason: "provider_content_rejected",
        })),
      };
    if (
      !(error instanceof Error) ||
      ![
        "fusion_invalid_response",
        "custom_ai_invalid_json",
        "custom_ai_response_truncated",
        "ai_invalid_json_response",
      ].includes(error.message)
    )
      throw error;
    if (rows.length <= 3)
      return {
        segments: rows.map((row) => ({
          id: row.id,
          text: row.text,
          uncertain: true,
          cloudIds: [],
          reviewReason:
            error.message === "fusion_invalid_response"
              ? "provider_invalid_response"
              : "provider_invalid_json",
        })),
      };
    const instructions = request.prompt.split("\n").slice(0, -2).join("\n");
    const segments: Reply["segments"] = [];
    const half = Math.ceil(rows.length / 2);
    for (const subset of [rows.slice(0, half), rows.slice(half)]) {
      const refs = references.filter((c) => subset.some((row) => overlaps(row, c)));
      const sourceRows = subset.map(({ id, text, startMs, endMs, speakerId, memberId }) => ({
        id,
        text,
        startMs,
        endMs,
        speakerId,
        memberId,
        allowedCloudIds: refs
          .filter((c) =>
            overlaps(
              subset.find((row) => row.id === id)!,
              c,
            ),
          )
          .map((c) => c.id),
      }));
      const cloudRows = refs.map(({ id, text, startMs, endMs, speakerId, memberId }) => ({
        id,
        text,
        startMs,
        endMs,
        speakerId,
        memberId,
      }));
      const result = await generateFusionBatch(
        generate,
        {
          ...request,
          prompt: `${instructions}\n本地语句：${JSON.stringify(sourceRows)}\n云端参照：${JSON.stringify(cloudRows)}`,
        },
        subset,
        refs,
      );
      segments.push(...result.segments);
    }
    return { segments };
  }
}
