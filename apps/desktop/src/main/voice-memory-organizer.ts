import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  isReliableTranscriptText,
  mergeTranscriptIntoSentences,
  type VoiceMemoryRecord,
  type VoiceMemoryOrganizationResult,
  type VoiceMemoryOrganizationChunk,
  type VoiceMemoryOrganizationMetrics,
  type VoiceMemorySummaryPoint,
  type VoiceMemoryChapter,
  type VoiceMemoryHighlight,
  type VoiceMemoryMarkerTitle,
} from "@private-voice/shared";
import { QWEN36_NVFP4_MODEL_REVISION } from "./ai-model-catalog";
import type { AiTextGateway } from "./ai-text-gateway";
import {
  materializeOrganizationChunks,
  normalizeOrganizationResult,
  organizationChunkPrompt,
  organizationFinalPrompt,
  planRecordingOrganizationChunks,
  RECORDING_ORGANIZATION_PIPELINE_VERSION,
} from "./recording-organizer";
import {
  MAX_ORGANIZATION_ATTEMPTS_PER_RUN,
  organizationExhausted,
  resetOrganizationRetry,
  runOrganizationWithRetry,
} from "./organization-retry";

interface OrganizedResult {
  summary: VoiceMemorySummaryPoint[];
  chapters: VoiceMemoryChapter[];
  highlights: VoiceMemoryHighlight[];
  markerTitles: VoiceMemoryMarkerTitle[];
}

const createOrganizationMetrics = (): VoiceMemoryOrganizationMetrics => ({
  modelName: "Qwen3.6-35B-A3B",
  modelRevision: QWEN36_NVFP4_MODEL_REVISION,
  quantization: "NVFP4",
  provider: "freetoken",
  inputTokens: 0,
  outputTokens: 0,
  totalElapsedMs: 0,
  oomCount: 0,
  retryCount: 0,
  chunkCount: 0,
  interrupted: false,
  errors: [],
});

const mergeOrganizationMetrics = (
  current: VoiceMemoryOrganizationMetrics,
  next: Partial<VoiceMemoryOrganizationMetrics>,
): VoiceMemoryOrganizationMetrics => {
  const previousOutput = current.outputTokens;
  const nextOutput = next.outputTokens ?? 0;
  const totalOutput = previousOutput + nextOutput;
  const weighted = (left?: number, right?: number): number | undefined => {
    if (right === undefined) return left;
    if (left === undefined || previousOutput === 0) return right;
    return totalOutput > 0 ? (left * previousOutput + right * nextOutput) / totalOutput : right;
  };
  return {
    ...current,
    providerVersion: next.providerVersion ?? current.providerVersion,
    modelLoadTimeMs: next.modelLoadTimeMs ?? current.modelLoadTimeMs,
    inputTokens: current.inputTokens + (next.inputTokens ?? 0),
    outputTokens: totalOutput,
    prefillTimeMs:
      current.prefillTimeMs === undefined && next.prefillTimeMs === undefined
        ? undefined
        : (current.prefillTimeMs ?? 0) + (next.prefillTimeMs ?? 0),
    ttftMs: weighted(current.ttftMs, next.ttftMs),
    outputTokensPerSecond: weighted(current.outputTokensPerSecond, next.outputTokensPerSecond),
    totalElapsedMs: current.totalElapsedMs + (next.totalElapsedMs ?? 0),
    peakVramMb: Math.max(current.peakVramMb ?? 0, next.peakVramMb ?? 0) || undefined,
    peakRamMb: Math.max(current.peakRamMb ?? 0, next.peakRamMb ?? 0) || undefined,
    oomCount: current.oomCount + (next.oomCount ?? 0),
  };
};

const MAX_ORGANIZATION_REDUCTION_INPUT_TOKENS = 5_000;

const estimateOrganizationPromptTokens = (value: string): number => {
  const han = (value.match(/[\p{Script=Han}]/gu) ?? []).length;
  return han + Math.ceil(Math.max(0, value.length - han) / 3.5);
};

const partitionOrganizationResults = (
  record: VoiceMemoryRecord,
  results: readonly VoiceMemoryOrganizationResult[],
): VoiceMemoryOrganizationResult[][] => {
  const groups: VoiceMemoryOrganizationResult[][] = [];
  let current: VoiceMemoryOrganizationResult[] = [];
  for (const result of results) {
    const candidate = [...current, result];
    const estimatedTokens = estimateOrganizationPromptTokens(
      organizationFinalPrompt(record, candidate),
    );
    if (current.length > 0 && estimatedTokens > MAX_ORGANIZATION_REDUCTION_INPUT_TOKENS) {
      groups.push(current);
      current = [result];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
};

export const transcriptForPrompt = (
  record: VoiceMemoryRecord,
  maximumCharacters = 36_000,
): string =>
  mergeTranscriptIntoSentences(record.transcript)
    .filter((segment) =>
      isReliableTranscriptText(segment.text, Math.max(100, segment.endMs - segment.startMs)),
    )
    .map(
      (segment) =>
        `[${Math.round(segment.startMs / 1_000)}s] ${segment.nickname ?? segment.speakerId}: ${segment.text}`,
    )
    .join("\n")
    .slice(0, maximumCharacters);

const asArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  return value && typeof value === "object" ? [value as T] : [];
};

const normalizeOrganizedResult = (value: unknown, record: VoiceMemoryRecord): OrganizedResult => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const summary = asArray<Record<string, unknown>>(raw.summary)
    .filter((item) => typeof item.text === "string" && item.text.trim())
    .map((item) => ({
      text: String(item.text).trim(),
      sourceStartMs: typeof item.sourceStartMs === "number" ? item.sourceStartMs : undefined,
      sourceSegmentIds: Array.isArray(item.sourceSegmentIds)
        ? item.sourceSegmentIds.map((id) => {
            if (typeof id === "number") return record.transcript[id]?.id ?? String(id);
            return String(id);
          })
        : undefined,
    }));
  const chapters = asArray<Record<string, unknown>>(raw.chapters)
    .filter((item) => typeof item.title === "string" && Number.isFinite(Number(item.startMs)))
    .map((item, index) => ({
      id: String(item.id ?? `chapter-${index + 1}`),
      startMs: Number(item.startMs),
      title: String(item.title).trim(),
      description: typeof item.description === "string" ? item.description.trim() : undefined,
    }));
  const highlights = asArray<Record<string, unknown>>(raw.highlights)
    .filter(
      (item) =>
        typeof item.title === "string" &&
        Number.isFinite(Number(item.startMs)) &&
        Number.isFinite(Number(item.endMs)),
    )
    .map((item, index) => ({
      id: String(item.id ?? `highlight-${index + 1}`),
      title: String(item.title).trim(),
      startMs: Number(item.startMs),
      endMs: Number(item.endMs),
      description: typeof item.description === "string" ? item.description.trim() : "",
      transcriptSegmentIds: Array.isArray(item.transcriptSegmentIds)
        ? item.transcriptSegmentIds.map((id) => String(id))
        : [],
      exportable: item.exportable !== false,
    }));
  const markerTitles = asArray<Record<string, unknown>>(raw.markerTitles)
    .filter(
      (item) =>
        typeof item.markerId === "string" &&
        typeof item.title === "string" &&
        Number.isFinite(Number(item.offsetMs)),
    )
    .map((item) => ({
      markerId: String(item.markerId),
      offsetMs: Number(item.offsetMs),
      title: String(item.title).trim(),
    }));
  return { summary, chapters, highlights, markerTitles };
};

/** Plans and resumes organization; persistence remains owned by the caller. */
export class VoiceMemoryOrganizer {
  constructor(
    private readonly textGateway: Pick<
      AiTextGateway,
      "usesLocalOrganizer" | "generateJson" | "generateJsonWithMetrics"
    >,
    private readonly save: (record: VoiceMemoryRecord) => Promise<VoiceMemoryRecord>,
  ) {}

  async organize(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
  ): Promise<VoiceMemoryRecord> {
    if (signal.aborted) throw new Error("ai_task_paused");
    if (record.transcript.length === 0) return record;
    if (manual && record.organizationSinglePassRetry) {
      record = await this.save({
        ...record,
        organizationSinglePassRetry:
          record.organizationSinglePassRetry.status === "completed"
            ? undefined
            : resetOrganizationRetry(record.organizationSinglePassRetry),
      });
    }
    // Only an explicit foreground action grants exhausted work another budget.
    if (manual && record.organization) {
      record = await this.save({
        ...record,
        organization: {
          ...record.organization,
          chunks: record.organization.chunks.map(resetOrganizationRetry),
          reductionRetries: Object.fromEntries(
            Object.entries(record.organization.reductionRetries ?? {}).map(([key, value]) => [
              key,
              resetOrganizationRetry(value),
            ]),
          ),
        },
      });
    }
    if (!this.textGateway.usesLocalOrganizer()) {
      return this.organizeSinglePass(record, manual, signal);
    }
    const readableTranscript = mergeTranscriptIntoSentences(record.transcript);
    const preparedRecord = { ...record, transcript: readableTranscript };
    const plans = planRecordingOrganizationChunks(preparedRecord);
    if (plans.length === 0) return preparedRecord;
    const compatibleRun =
      record.organization?.pipelineVersion === RECORDING_ORGANIZATION_PIPELINE_VERSION &&
      record.organization.modelId === "qwen36-35b-a3b-nvfp4" &&
      record.organization.modelRevision === QWEN36_NVFP4_MODEL_REVISION;
    let chunks = materializeOrganizationChunks(
      plans,
      compatibleRun
        ? record.organization?.chunks
        : record.organization?.chunks.map((chunk) => ({
            ...chunk,
            result: undefined,
            status: organizationExhausted(chunk)
              ? ("unrecoverable" as const)
              : ("pending" as const),
          })),
    );
    let metrics = compatibleRun
      ? (record.organization?.metrics ?? createOrganizationMetrics())
      : createOrganizationMetrics();
    const startedAt = compatibleRun
      ? (record.organization?.startedAt ?? new Date().toISOString())
      : new Date().toISOString();
    record = await this.save({
      ...preparedRecord,
      transcript: readableTranscript,
      phase: "organizing",
      progress: 75,
      errorMessage: undefined,
      organizationPublication: undefined,
      organization: {
        pipelineVersion: RECORDING_ORGANIZATION_PIPELINE_VERSION,
        modelId: "qwen36-35b-a3b-nvfp4",
        modelRevision: QWEN36_NVFP4_MODEL_REVISION,
        status: "running",
        completedChunks: chunks.filter((chunk) => chunk.status === "completed").length,
        chunks,
        reductionRetries: record.organization?.reductionRetries,
        finalResult: compatibleRun ? record.organization?.finalResult : undefined,
        metrics,
        startedAt,
        updatedAt: new Date().toISOString(),
      },
    });

    ({ record, chunks, metrics } = await this.organizeChunks(
      record,
      chunks,
      metrics,
      manual,
      signal,
    ));
    const reduced = await this.reduceChunks(record, chunks, metrics, manual, signal);
    return this.publishOrganization(reduced.record, chunks, reduced.metrics, reduced.finalResult);
  }

  private async organizeChunks(
    record: VoiceMemoryRecord,
    chunks: VoiceMemoryOrganizationChunk[],
    metrics: VoiceMemoryOrganizationMetrics,
    manual: boolean,
    signal: AbortSignal,
  ) {
    for (let index = 0; index < chunks.length; index += 1) {
      const currentChunk = chunks[index];
      if (!currentChunk) continue;
      if (currentChunk.status === "completed" && currentChunk.result) continue;
      let completed = false;
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_ORGANIZATION_ATTEMPTS_PER_RUN; attempt += 1) {
        if (signal.aborted) {
          metrics = { ...metrics, interrupted: true };
          await this.save({
            ...record,
            phase: "paused",
            organization: {
              ...record.organization!,
              status: "paused",
              chunks,
              metrics,
              updatedAt: new Date().toISOString(),
            },
          });
          throw new Error("ai_task_paused");
        }
        const baseChunk = chunks[index];
        if (!baseChunk) throw new Error("organization_chunk_missing");
        if (organizationExhausted(baseChunk)) {
          lastError = new Error("organization_retry_exhausted");
          break;
        }
        const running = {
          ...baseChunk,
          status: "running" as const,
          attempts: baseChunk.attempts + 1,
          errorMessage: undefined,
          updatedAt: new Date().toISOString(),
        };
        chunks = chunks.map((chunk, chunkIndex) => (chunkIndex === index ? running : chunk));
        record = await this.save({
          ...record,
          progress:
            75 +
            (20 * chunks.filter((chunk) => chunk.status === "completed").length) / chunks.length,
          organization: {
            ...record.organization!,
            status: "running",
            chunks,
            metrics,
            updatedAt: new Date().toISOString(),
          },
        });
        try {
          const generated = await this.textGateway.generateJsonWithMetrics<unknown>({
            purpose: "organize",
            manual,
            maxNewTokens: 3_072,
            timeoutMs: 30 * 60_000,
            signal,
            prompt: organizationChunkPrompt(record, running),
          });
          if (signal.aborted) throw new Error("ai_task_paused");
          const result = normalizeOrganizationResult(
            generated.value,
            record,
            running.startMs,
            running.endMs,
          );
          if (generated.metrics) metrics = mergeOrganizationMetrics(metrics, generated.metrics);
          metrics = { ...metrics, chunkCount: metrics.chunkCount + 1 };
          const finished = {
            ...running,
            status: "completed" as const,
            result,
            updatedAt: new Date().toISOString(),
          };
          chunks = chunks.map((chunk, chunkIndex) => (chunkIndex === index ? finished : chunk));
          record = await this.save({
            ...record,
            progress:
              75 +
              (20 * chunks.filter((chunk) => chunk.status === "completed").length) / chunks.length,
            organization: {
              ...record.organization!,
              status: "running",
              completedChunks: chunks.filter((chunk) => chunk.status === "completed").length,
              chunks,
              metrics,
              updatedAt: new Date().toISOString(),
            },
          });
          completed = true;
          break;
        } catch (error) {
          lastError = error;
          if (signal.aborted || (error instanceof Error && error.message === "ai_task_paused"))
            break;
          if (attempt + 1 < MAX_ORGANIZATION_ATTEMPTS_PER_RUN) {
            metrics = { ...metrics, retryCount: metrics.retryCount + 1 };
          }
        }
      }
      if (!completed) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        const failedBase = chunks[index];
        if (!failedBase) throw new Error("organization_chunk_missing");
        const failed = {
          ...failedBase,
          status: organizationExhausted(failedBase)
            ? ("unrecoverable" as const)
            : ("failed" as const),
          errorMessage: message,
          updatedAt: new Date().toISOString(),
        };
        chunks = chunks.map((chunk, chunkIndex) => (chunkIndex === index ? failed : chunk));
        metrics = {
          ...metrics,
          interrupted: signal.aborted,
          oomCount:
            metrics.oomCount + (/out of memory|\boom\b|cuda.*memory/i.test(message) ? 1 : 0),
          errors: [...metrics.errors, `chunk_${index + 1}:${message}`].slice(-30),
        };
        await this.save({
          ...record,
          phase: signal.aborted ? "paused" : "error",
          organization: {
            ...record.organization!,
            status: signal.aborted ? "paused" : failed.status,
            chunks,
            metrics,
            updatedAt: new Date().toISOString(),
          },
          errorMessage: signal.aborted ? undefined : `organize_failed:${message}`,
        });
        throw lastError instanceof Error ? lastError : new Error(message);
      }
    }

    return { record, chunks, metrics };
  }

  private async reduceChunks(
    record: VoiceMemoryRecord,
    chunks: VoiceMemoryOrganizationChunk[],
    metrics: VoiceMemoryOrganizationMetrics,
    manual: boolean,
    signal: AbortSignal,
  ) {
    let finalResult: VoiceMemoryOrganizationResult | undefined;
    let finalError: unknown;
    let reductionLevel = 0;
    let reductionResults = chunks
      .map((chunk) => chunk.result)
      .filter((result): result is VoiceMemoryOrganizationResult => Boolean(result));
    try {
      while (reductionResults.length > 1) {
        if (signal.aborted) throw new Error("ai_task_paused");
        const groups = partitionOrganizationResults(record, reductionResults);
        // A malformed oversized saved result must not make the reducer loop forever.
        const effectiveGroups =
          groups.length < reductionResults.length
            ? groups
            : Array.from({ length: Math.ceil(reductionResults.length / 2) }, (_, index) =>
                reductionResults.slice(index * 2, index * 2 + 2),
              );
        const nextLevel: VoiceMemoryOrganizationResult[] = [];
        for (let groupIndex = 0; groupIndex < effectiveGroups.length; groupIndex += 1) {
          const group = effectiveGroups[groupIndex];
          if (!group) continue;
          let reduced: VoiceMemoryOrganizationResult | undefined;
          let groupError: unknown;
          const retryKey = `${reductionLevel}:${groupIndex}:${createHash("sha256").update(JSON.stringify(group)).digest("hex").slice(0, 16)}`;
          try {
            reduced = await runOrganizationWithRetry(
              record.organization?.reductionRetries?.[retryKey],
              async (state) => {
                record = await this.save({
                  ...record,
                  organization: {
                    ...record.organization!,
                    reductionRetries: {
                      ...record.organization?.reductionRetries,
                      [retryKey]: state,
                    },
                  },
                });
              },
              async () => {
                const generation = await this.textGateway.generateJsonWithMetrics<unknown>({
                  purpose: "organize",
                  manual,
                  maxNewTokens: 3_072,
                  timeoutMs: 30 * 60_000,
                  signal,
                  prompt: organizationFinalPrompt(record, group),
                });
                if (generation.metrics)
                  metrics = mergeOrganizationMetrics(metrics, generation.metrics);
                return normalizeOrganizationResult(generation.value, record);
              },
              signal,
            );
          } catch (error) {
            groupError = error;
          }
          if (!reduced) {
            throw groupError instanceof Error
              ? groupError
              : new Error(`organization_reduce_failed_${reductionLevel}_${groupIndex}`);
          }
          nextLevel.push(reduced);
        }
        reductionResults = nextLevel;
        reductionLevel += 1;
      }
      finalResult = reductionResults[0];
    } catch (error) {
      finalError = error;
    }
    if (!finalResult) {
      const message = finalError instanceof Error ? finalError.message : String(finalError);
      const paused = signal.aborted || message === "ai_task_paused";
      metrics = {
        ...metrics,
        interrupted: paused,
        oomCount: metrics.oomCount + (/out of memory|\boom\b|cuda.*memory/i.test(message) ? 1 : 0),
        chunkCount: chunks.length,
        errors: [...metrics.errors, `final:${message}`].slice(-30),
      };
      await this.save({
        ...record,
        phase: paused ? "paused" : "error",
        organization: {
          ...record.organization!,
          status: paused
            ? "paused"
            : Object.values(record.organization?.reductionRetries ?? {}).some(organizationExhausted)
              ? "unrecoverable"
              : "failed",
          completedChunks: chunks.filter((chunk) => chunk.status === "completed").length,
          chunks,
          metrics,
          updatedAt: new Date().toISOString(),
        },
        errorMessage: paused ? undefined : `organize_failed:${message}`,
      });
      throw finalError instanceof Error ? finalError : new Error(message);
    }
    return { record, metrics, finalResult };
  }

  private publishOrganization(
    record: VoiceMemoryRecord,
    chunks: VoiceMemoryOrganizationChunk[],
    metrics: VoiceMemoryOrganizationMetrics,
    finalResult: VoiceMemoryOrganizationResult,
  ): Promise<VoiceMemoryRecord> {
    metrics = { ...metrics, chunkCount: chunks.length, interrupted: false };
    const normalized: OrganizedResult = {
      summary: finalResult.summary,
      chapters: finalResult.topics.map((topic) => ({
        id: topic.id,
        startMs: topic.startMs,
        title: topic.title,
        description: topic.description,
      })),
      highlights: [...finalResult.highlights, ...finalResult.funnyMoments].map((highlight) => ({
        id: highlight.id,
        title: highlight.title,
        startMs: highlight.startMs,
        endMs: highlight.endMs,
        description: highlight.description,
        transcriptSegmentIds: highlight.sourceSegmentIds,
        exportable: true,
      })),
      markerTitles: record.markerTitles,
    };
    return this.save({
      ...record,
      summary: normalized.summary,
      chapters: normalized.chapters,
      highlights: normalized.highlights,
      markerTitles:
        normalized.markerTitles.length > 0 ? normalized.markerTitles : record.markerTitles,
      organizedAt: new Date().toISOString(),
      timeline: [
        ...record.timeline
          .filter((entry) => entry.kind === "marker")
          .map((entry) => ({
            ...entry,
            title:
              normalized.markerTitles.find((marker) => marker.markerId === entry.id)?.title ??
              entry.title,
          })),
        ...normalized.chapters.map((chapter) => ({
          id: chapter.id || randomUUID(),
          kind: "chapter" as const,
          offsetMs: chapter.startMs,
          title: chapter.title,
          detail: chapter.description,
        })),
        ...normalized.highlights.map((highlight) => ({
          id: highlight.id || randomUUID(),
          kind: "highlight" as const,
          offsetMs: highlight.startMs,
          endMs: highlight.endMs,
          title: highlight.title,
          detail: highlight.description,
        })),
      ].sort((a, b) => a.offsetMs - b.offsetMs),
      progress: 98,
      organization: {
        ...record.organization!,
        status: "completed",
        completedChunks: chunks.length,
        chunks,
        finalResult,
        metrics,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  private async organizeSinglePass(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
  ): Promise<VoiceMemoryRecord> {
    const readableTranscript = mergeTranscriptIntoSentences(record.transcript);
    record = await this.save({
      ...record,
      transcript: readableTranscript,
      phase: "organizing",
      progress: 75,
      errorMessage: undefined,
      organizationPublication: undefined,
    });
    const result = await runOrganizationWithRetry(
      record.organizationSinglePassRetry,
      async (state) => {
        record = await this.save({ ...record, organizationSinglePassRetry: state });
      },
      () =>
        this.textGateway.generateJson<OrganizedResult>({
          purpose: "organize",
          manual,
          maxNewTokens: 384,
          timeoutMs: 4 * 60_000,
          signal,
          prompt: [
            "你是上号语音软件的录音整理助手。这里是固定好友的日常聊天，不是会议。",
            "生成自然、有趣、能回到原录音的结构化结果，不要编造。",
            '只返回 JSON：{"summary":[],"chapters":[],"highlights":[],"markerTitles":[]}。',
            `已有标记：${record.markerTitles.map((marker) => `${marker.markerId}@${marker.offsetMs}ms`).join(", ") || "无"}`,
            `录音：${path.basename(record.filePath)}`,
            transcriptForPrompt(record, 36_000),
          ].join("\n"),
        }),
      signal,
    );
    const normalized = normalizeOrganizedResult(result, record);
    return this.save({
      ...record,
      summary: normalized.summary,
      chapters: normalized.chapters,
      highlights: normalized.highlights,
      markerTitles:
        normalized.markerTitles.length > 0 ? normalized.markerTitles : record.markerTitles,
      organizedAt: new Date().toISOString(),
      progress: 98,
    });
  }
}
