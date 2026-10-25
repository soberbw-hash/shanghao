/** Explicit live test only. Never imported by automated smoke; writes only an isolated copy. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { mergeTranscriptIntoSentences, type VoiceMemoryRecord } from "@private-voice/shared";
import { CustomAiProviderStore } from "../src/main/custom-ai-provider-store";
import {
  AiTextGateway,
  type GenerateJsonRequest,
  type GeneratedJson,
} from "../src/main/ai-text-gateway";
import { fuseTranscripts } from "../src/main/transcript-fusion";
import { VoiceMemoryOrganizer } from "../src/main/voice-memory-organizer";
import { fusionSegmentsOverlap } from "../src/main/transcript-fusion-coverage";
import { organizationChunkPrompt } from "../src/main/recording-organizer";

export async function runLiveRecordingProbe(provider: CustomAiProviderStore, source: string) {
  if (!process.argv.includes("--probe-long-recording"))
    throw Error("probe_explicit_opt_in_required");
  const originalPath = path.join(
    source,
    "voice-memory/records/878552ee-7bda-4741-8169-8ef8348d79c9.json",
  );
  const originalBytes = readFileSync(originalPath);
  const original = JSON.parse(originalBytes.toString("utf8")) as VoiceMemoryRecord;
  const originalHash = createHash("sha256").update(originalBytes).digest("hex");
  const summaryOnly = process.argv.includes("--probe-summary-only");
  const root = path.resolve(
    summaryOnly
      ? "artifacts/live-recording-provider-summary-probe"
      : "artifacts/live-recording-provider-probe",
  );
  mkdirSync(root, { recursive: true });
  const checkpoint = path.join(root, "checkpoint.json");
  const signaturePath = path.join(root, "source-sha256");
  if (existsSync(signaturePath) && readFileSync(signaturePath, "utf8") !== originalHash)
    throw Error("probe_source_changed");
  if (!existsSync(signaturePath))
    writeFileSync(signaturePath, originalHash, { flag: "wx", mode: 0o600 });
  if (!existsSync(path.join(root, "original.json")))
    writeFileSync(path.join(root, "original.json"), originalBytes, { flag: "wx", mode: 0o600 });
  const originals = JSON.stringify(original.transcriptionVariants);
  const activeTranscript = JSON.stringify(original.transcript);
  const save = async (record: VoiceMemoryRecord) => {
    if (
      JSON.stringify(record.transcriptionVariants) !== originals ||
      JSON.stringify(record.transcript) !== activeTranscript
    )
      throw Error("probe_originals_changed");
    writeFileSync(`${checkpoint}.tmp`, JSON.stringify(record), { mode: 0o600 });
    renameSync(`${checkpoint}.tmp`, checkpoint);
    console.log(
      JSON.stringify({
        stage: "checkpoint",
        fusion: record.transcriptionFusion?.status,
        batches: record.transcriptionFusion?.completedBatches,
        totalBatches: record.transcriptionFusion?.totalBatches,
        organization: record.organization?.status,
        chunks: record.organization?.completedChunks,
        totalChunks: record.organization?.chunks.length,
      }),
    );
    return record;
  };
  const gateway = new AiTextGateway(
    { getSnapshot: () => ({ aiOrganizerProvider: "custom" }) } as never,
    {} as never,
    {} as never,
    {} as never,
    provider,
    {} as never,
  );
  const controller = new AbortController();
  let textGenerationRequests = 0;
  const generate = gateway.generateJsonWithMetrics.bind(gateway);
  gateway.generateJsonWithMetrics = async <T>(
    request: GenerateJsonRequest,
  ): Promise<GeneratedJson<T>> => {
    textGenerationRequests++;
    return generate<T>(request);
  };
  if (process.argv.includes("--probe-failed-chunk-only")) {
    const saved = JSON.parse(
      readFileSync(path.resolve("artifacts/live-recording-provider-probe/checkpoint.json"), "utf8"),
    ) as VoiceMemoryRecord;
    const failed = saved.organization?.chunks.find((chunk) => chunk.status === "failed");
    if (!failed || saved.transcriptionFusion?.status !== "completed")
      throw Error("probe_failed_summary_chunk_required");
    const prepared = {
      ...saved,
      transcript: mergeTranscriptIntoSentences(saved.transcriptionFusion.transcript),
    };
    await gateway.generateJson({
      purpose: "organize",
      manual: true,
      roomId: prepared.roomId,
      maxNewTokens: 3072,
      prompt: organizationChunkPrompt(prepared, failed),
    });
    console.log(
      JSON.stringify({
        stage: "failed-summary-chunk",
        index: failed.index,
        jsonResponseValid: true,
        checkpointModified: false,
      }),
    );
    return;
  }
  let record = existsSync(checkpoint)
    ? (JSON.parse(readFileSync(checkpoint, "utf8")) as VoiceMemoryRecord)
    : summaryOnly
      ? (JSON.parse(
          readFileSync(
            path.resolve("artifacts/live-recording-provider-probe/checkpoint.json"),
            "utf8",
          ),
        ) as VoiceMemoryRecord)
      : original;
  if (summaryOnly && record.transcriptionFusion?.status !== "completed")
    throw Error("probe_completed_fusion_required");
  if (!summaryOnly)
    record = await fuseTranscripts(record, {
      signal: controller.signal,
      manual: true,
      save,
      generate: async (request) => {
        const reply = await gateway.generateJson<{
          segments?: Array<{
            id?: string;
            text?: unknown;
            uncertain?: unknown;
            cloudIds?: unknown;
          }>;
        }>(request);
        const rows = JSON.parse(
          request.prompt.split("本地语句：")[1]!.split("\n云端参照：")[0]!,
        ) as Array<{ id: string; startMs: number; endMs: number }>;
        const cloud = JSON.parse(request.prompt.split("\n云端参照：")[1]!) as Array<{
          id: string;
          startMs: number;
          endMs: number;
        }>;
        console.log(
          JSON.stringify({
            stage: "fusion-reference-shape",
            nonoverlapping: reply?.segments
              ?.flatMap((s) =>
                Array.isArray(s.cloudIds) ? s.cloudIds.map((id) => ({ id, local: s.id })) : [],
              )
              .filter((item) => {
                const row = rows.find((r) => r.id === item.local),
                  ref = cloud.find((c) => c.id === item.id);
                return row && ref && !fusionSegmentsOverlap(row, ref);
              }).length,
          }),
        );
        console.log(
          JSON.stringify({
            stage: "fusion-reply-shape",
            expected: rows.length,
            actual: reply?.segments?.length,
            uniqueIds: new Set(reply?.segments?.map((s) => s.id)).size,
            knownIds: reply?.segments?.filter((s) => rows.some((r) => r.id === s.id)).length,
            textFields: reply?.segments?.filter((s) => typeof s.text === "string" && s.text.trim())
              .length,
            uncertainFields: reply?.segments?.filter((s) => typeof s.uncertain === "boolean")
              .length,
            cloudArrays: reply?.segments?.filter((s) => Array.isArray(s.cloudIds)).length,
            foreignCloudRefs: reply?.segments
              ?.flatMap((s) => (Array.isArray(s.cloudIds) ? s.cloudIds : []))
              .filter((id) => !cloud.some((c) => c.id === id)).length,
          }),
        );
        return reply;
      },
    });
  if (record.transcriptionFusion?.status !== "completed")
    throw Error(record.transcriptionFusion?.errorCode ?? "probe_fusion_incomplete");
  const organizer = new VoiceMemoryOrganizer(gateway, save);
  const organized = await organizer.organize(record, true, controller.signal);
  await save(organized);
  if (!readFileSync(originalPath).equals(originalBytes)) throw Error("probe_source_changed");
  console.log(
    JSON.stringify({
      stage: "complete",
      fusion: record.transcriptionFusion.status,
      organization: organized.organization?.status,
      summaryPoints: organized.summary.length,
      textGenerationRequests,
      originalProfileModified: false,
      originalsPreserved: true,
    }),
  );
}
