import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  mergeTranscriptIntoSentences,
  type VoiceMemoryOrganizationResult,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import { FreeTokenLocalLlmProvider } from "../src/main/freetoken-local-llm-provider";
import {
  materializeOrganizationChunks,
  normalizeOrganizationResult,
  organizationChunkPrompt,
  planRecordingOrganizationChunks,
} from "../src/main/recording-organizer";

const REVISION = "1355db6a052410cfd62085d94b58866fd0f2c3c5";
const defaultRecordPath = path.join(
  process.env.APPDATA ?? process.cwd(),
  "shanghao",
  "voice-memory",
  "records",
  "49fd8403-eaf5-444e-a6ba-70ea4c252801.json",
);
const recordPath = process.env.SHANGHAO_VERIFY_RECORD ?? defaultRecordPath;
const modelsRoot =
  process.env.SHANGHAO_AI_MODELS_ROOT ??
  path.join(process.env.APPDATA ?? process.cwd(), "shanghao", "ai-models");
const modelDirectory = path.join(modelsRoot, "qwen36-35b-a3b-nvfp4", REVISION);

const structuralCounts = (result: VoiceMemoryOrganizationResult) => ({
  descriptionPresent: result.description.trim().length > 0,
  summary: result.summary.length,
  topics: result.topics.length,
  timeline: result.timeline.length,
  highlights: result.highlights.length,
  funnyMoments: result.funnyMoments.length,
  importantInformation: result.importantInformation.length,
  participants: result.participants.length,
  keywords: result.keywords.length,
});

const main = async (): Promise<void> => {
  if (!existsSync(recordPath)) throw new Error(`Verification record is missing: ${recordPath}`);
  if (!existsSync(path.join(modelDirectory, "model.safetensors.index.json"))) {
    throw new Error(`Qwen3.6 model is incomplete: ${modelDirectory}`);
  }

  const sourceRecord = JSON.parse(readFileSync(recordPath, "utf8")) as VoiceMemoryRecord;
  const record = {
    ...sourceRecord,
    transcript: mergeTranscriptIntoSentences(sourceRecord.transcript),
  };
  const plans = planRecordingOrganizationChunks(record);
  const chunks = materializeOrganizationChunks(plans, undefined);
  const chunk = chunks[0];
  if (!chunk) throw new Error("No reliable transcript chunk is available for verification");

  // This script deliberately never writes the record back. It exercises the
  // largest first real chunk while keeping the user's library untouched.
  process.stdout.write(
    `${JSON.stringify({
      verification: "non_mutating_real_transcript",
      recordingId: record.recordingId,
      sourceSegments: sourceRecord.transcript.length,
      mergedSegments: record.transcript.length,
      plannedChunkCount: plans.length,
      plannedChunks: plans.slice(0, 12).map((plan) => ({
        index: plan.index,
        startMs: plan.startMs,
        endMs: plan.endMs,
        sourceSegments: plan.sourceSegmentIds.length,
        estimatedInputTokens: plan.estimatedInputTokens,
      })),
      maxEstimatedInputTokens: Math.max(...plans.map((plan) => plan.estimatedInputTokens)),
      selectedChunk: chunk.index,
    })}\n`,
  );

  if (process.env.SHANGHAO_VERIFY_PLAN_ONLY === "1") return;

  const provider = new FreeTokenLocalLlmProvider(
    () => modelDirectory,
    REVISION,
    async (payload) => {
      process.stdout.write(
        `${JSON.stringify({ logLevel: payload.level, log: payload.message, context: payload.context })}\n`,
      );
    },
  );
  const controller = new AbortController();
  const unsubscribe = provider.onStatus((status) => {
    process.stdout.write(
      `${JSON.stringify({
        phase: status.metrics.phase,
        ready: status.ready,
        version: status.metrics.version,
        message: status.message,
      })}\n`,
    );
  });
  const interrupt = (): void => {
    controller.abort();
    provider.stop();
    process.exitCode = 130;
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const generated = await provider.generateJson<unknown>({
      prompt: organizationChunkPrompt(record, chunk),
      maxNewTokens: 3_072,
      timeoutMs: 30 * 60_000,
      signal: controller.signal,
    });
    const normalized = normalizeOrganizationResult(
      generated.value,
      record,
      chunk.startMs,
      chunk.endMs,
    );
    const counts = structuralCounts(normalized);
    if (!counts.descriptionPresent && counts.summary + counts.timeline + counts.topics === 0) {
      throw new Error("FreeToken returned JSON without usable organization content");
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          result: "success",
          selectedRangeMs: [chunk.startMs, chunk.endMs],
          sourceSegmentCount: chunk.sourceSegmentIds.length,
          structuralCounts: counts,
          metrics: generated.metrics,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    unsubscribe();
    provider.stop();
  }
};

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
