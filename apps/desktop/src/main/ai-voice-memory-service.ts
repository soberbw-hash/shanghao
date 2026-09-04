import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import {
  AI_ASR_MODEL_NAMES,
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  evaluateVoiceMemoryTranscriptionValidity,
  hasInvalidVoiceMemoryResult,
  isReliableTranscriptText,
  mergeTranscriptIntoSentences,
  type AiAsrModelId,
  type AiModelId,
  type AiAsrRuntimeStatus,
  type AiRuntimeStatus,
  type RendererLogPayload,
  type VoiceMemoryAnswer,
  type VoiceMemoryBenchmarkRunMetadata,
  type VoiceMemoryGlobalQuestionRequest,
  type VoiceMemoryChapter,
  type VoiceMemoryHighlight,
  type VoiceMemoryOrganizationMetrics,
  type VoiceMemoryOrganizationPublication,
  type VoiceMemoryOrganizationResult,
  type VoiceMemoryMarkerTitle,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryQuestionRequest,
  type VoiceMemoryRecord,
  type VoiceMemorySearchRequest,
  type VoiceMemorySearchResult,
  type VoiceMemorySpeakingObservation,
  type VoiceMemorySummaryPoint,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryTaskDiagnostic,
  type VoiceMemoryTaskStatus,
  type VoiceMemoryTranscriptionModel,
  type VoiceMemoryTranscriptionStats,
  type VoiceMemoryTranscriptionUnit,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

import { AiModelManager, QWEN36_NVFP4_MODEL_REVISION } from "./ai-model-manager";
import { AiRuntimeManager } from "./ai-runtime-manager";
import type { TranscriptionChunkRuntimeResult } from "./asr-benchmark-runtime";
import { classifyLocalModelRuntimeError } from "./local-model-runtime";
import { VoiceMemoryStore } from "./voice-memory-store";
import { resolveFfmpegExecutable } from "./media-runtime";
import { AiTextGateway } from "./ai-text-gateway";
import {
  materializeOrganizationChunks,
  normalizeOrganizationResult,
  organizationChunkPrompt,
  organizationFinalPrompt,
  planRecordingOrganizationChunks,
  RECORDING_ORGANIZATION_PIPELINE_VERSION,
} from "./recording-organizer";
import { loadRecordingSpeakerSegments } from "./recording-speaker-segments";
import { loadRecordingParticipantTracks } from "./recording-participant-tracks";
import {
  bindTranscriptToKnownSpeaker,
  mergeSpeakerTranscript,
  splitParticipantTracksIntoSpeakerSources,
  type KnownSpeakerTranscriptionSource,
} from "./speaker-transcript";

// Short units bound local inference memory and preserve useful seek points for models without
// word-level timestamps.
export const TRANSCRIPTION_CHUNK_MS = 30_000;
export const MOSS_CPP_TRANSCRIPTION_CHUNK_MS = 10 * 60_000;
export const AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS = 30 * 60_000;
export const benchmarkDurationForMode = (
  mode: "smoke" | "standard" | "long" | undefined,
  sourceDurationMs: number,
): number =>
  Math.min(
    sourceDurationMs,
    mode === "smoke" ? 3 * 60_000 : mode === "standard" ? 10 * 60_000 : sourceDurationMs,
  );

export const benchmarkRangeForMode = (
  mode: "smoke" | "standard" | "long" | undefined,
  sourceDurationMs: number,
): { sourceStartMs: number; sourceEndMs: number; clipDurationMs: number } => {
  const clipDurationMs = benchmarkDurationForMode(mode, sourceDurationMs);
  const sourceStartMs =
    mode === "standard" && clipDurationMs < sourceDurationMs
      ? Math.max(0, Math.floor((sourceDurationMs - clipDurationMs) / 2))
      : 0;
  return {
    sourceStartMs,
    sourceEndMs: sourceStartMs + clipDurationMs,
    clipDurationMs,
  };
};

export const resolveTranscriptionRunRange = (
  sourceDurationMs: number,
  benchmark: VoiceMemoryBenchmarkRunMetadata | undefined,
): { sourceStartMs: number; sourceEndMs: number; clipDurationMs: number } => {
  if (!benchmark) return benchmarkRangeForMode(undefined, sourceDurationMs);
  const savedClip = benchmark.clips?.[0];
  const fallback = benchmarkRangeForMode(benchmark.mode, sourceDurationMs);
  const sourceStartMs = Math.max(
    0,
    Math.min(
      sourceDurationMs,
      savedClip ? (savedClip.sourceStartMs ?? savedClip.startMs) : fallback.sourceStartMs,
    ),
  );
  const sourceEndMs = Math.max(
    sourceStartMs,
    Math.min(
      sourceDurationMs,
      savedClip?.sourceEndMs ??
        sourceStartMs +
          (savedClip ? Math.max(0, savedClip.endMs - savedClip.startMs) : fallback.clipDurationMs),
    ),
  );
  return { sourceStartMs, sourceEndMs, clipDurationMs: sourceEndMs - sourceStartMs };
};
const LEGACY_TRANSCRIPTION_CHUNK_MS = 10 * 60_000;
// Version 8 binds speaker identity to independent participant streams. Partial mixed-stream
// results must never be merged into this speaker-aware pipeline.
const TRANSCRIPTION_PIPELINE_VERSION = CURRENT_TRANSCRIPTION_PIPELINE_VERSION;
const MAX_TRANSCRIPTION_CHUNK_ATTEMPTS = 3;
const TRANSCRIPTION_CHUNK_RETRY_DELAY_MS = 1_000;
const MAX_ORGANIZATION_ATTEMPTS_PER_RUN = 2;

export const isFatalTranscriptionRuntimeFailure = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /(?:0xc000001d|-1073741795|3221225501|illegal instruction|ark_asr_(?:backend_missing|q8_model_missing|q8_quantization_required)|unable to compare versions for packaging|no package metadata was found|modulenotfounderror|no module named|importerror:|dll load failed)/i.test(
    message,
  );
};

export const canAutomaticallyTranscribeDuration = (durationMs: number): boolean =>
  durationMs <= AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS;

export const isRecoverableFfmpegFailure = (record: VoiceMemoryRecord): boolean =>
  record.phase === "error" &&
  (record.errorMessage === "ffmpeg_missing" || record.diagnostic?.errorCode === "ffmpeg_missing");

export const transcriptionModelMetadata = (
  modelId: AiAsrModelId,
  status: AiAsrRuntimeStatus,
): VoiceMemoryTranscriptionModel => ({
  id: modelId,
  name: status.modelName?.trim() || AI_ASR_MODEL_NAMES[modelId],
  ...(status.modelVersion?.trim() ? { version: status.modelVersion.trim() } : {}),
});

export const completedTranscriptionUnits = (
  checkpoint: { completedUnits: number; unitDurationMs?: number } | undefined,
  totalUnits: number,
  currentUnitDurationMs = TRANSCRIPTION_CHUNK_MS,
): number =>
  Math.min(
    totalUnits,
    Math.floor(
      ((checkpoint?.completedUnits ?? 0) *
        (checkpoint?.unitDurationMs ?? LEGACY_TRANSCRIPTION_CHUNK_MS)) /
        currentUnitDurationMs,
    ),
  );

export interface TranscriptionUnitDefinition {
  index: number;
  startMs: number;
  endMs: number;
  speakerId?: string;
}

const transcriptionUnitId = (
  recordingId: string,
  modelId: AiAsrModelId,
  definition: TranscriptionUnitDefinition,
): string =>
  [
    recordingId,
    modelId,
    definition.index,
    definition.startMs,
    definition.endMs,
    definition.speakerId,
  ]
    .map((value) => String(value ?? ""))
    .join(":");

export const createTranscriptionUnits = (
  recordingId: string,
  modelId: AiAsrModelId,
  definitions: readonly TranscriptionUnitDefinition[],
  existing: readonly VoiceMemoryTranscriptionUnit[] | undefined,
  checkpointCompletedUnits: number,
): VoiceMemoryTranscriptionUnit[] => {
  const existingById = new Map((existing ?? []).map((unit) => [unit.unitId, unit]));
  const now = new Date().toISOString();
  return definitions.map((definition) => {
    const unitId = transcriptionUnitId(recordingId, modelId, definition);
    const saved = existingById.get(unitId);
    if (saved && saved.modelId === modelId) {
      // A process can be killed between the pre-flight save and inference. A persisted running
      // unit is therefore recoverable work, never proof that the unit completed.
      return saved.status === "running"
        ? { ...saved, status: "pending", stage: undefined, updatedAt: now, heartbeatAt: now }
        : {
            ...saved,
            index: definition.index,
            startMs: definition.startMs,
            endMs: definition.endMs,
          };
    }
    const legacyCompleted = definition.index < checkpointCompletedUnits;
    return {
      unitId,
      modelId,
      pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
      index: definition.index,
      startMs: definition.startMs,
      endMs: definition.endMs,
      speakerId: definition.speakerId,
      status: legacyCompleted ? "completed" : "pending",
      attempts: legacyCompleted ? 1 : 0,
      retryCount: 0,
      processedAudioMs: legacyCompleted ? Math.max(1, definition.endMs - definition.startMs) : 0,
      coveredAudioMs: legacyCompleted ? Math.max(1, definition.endMs - definition.startMs) : 0,
      segmentCount: 0,
      updatedAt: now,
    };
  });
};

export const statsFromTranscriptionUnits = (
  audioDurationMs: number,
  units: readonly VoiceMemoryTranscriptionUnit[],
  transcript: readonly VoiceMemoryTranscriptSegment[],
  fallback?: VoiceMemoryTranscriptionStats,
): VoiceMemoryTranscriptionStats => {
  // Only completed units prove that audio was successfully processed. Failed,
  // pending, and interrupted units must not inflate coverage or make a partial
  // run look complete when a legacy fallback still contains old totals.
  const completedUnitsForCoverage = units.filter((unit) => unit.status === "completed");
  const scheduledSpeechMs = units.reduce(
    (sum, unit) => sum + Math.max(1, unit.endMs - unit.startMs),
    0,
  );
  // Speaker-aware tracks may overlap, so completed per-speaker work can legitimately exceed
  // wall-clock clip duration. Keep the real scheduled work here; speechRatioPercent remains
  // clamped as a user-facing occupancy figure.
  const processedAudioMs = completedUnitsForCoverage.reduce(
    (sum, unit) => sum + Math.max(0, unit.processedAudioMs),
    0,
  );
  const coveredAudioMs = completedUnitsForCoverage.reduce(
    (sum, unit) => sum + Math.max(0, unit.coveredAudioMs),
    0,
  );
  const completedUnits = units.filter((unit) => unit.status === "completed").length;
  const pendingUnits = units.filter((unit) => unit.status === "pending").length;
  const runningUnits = units.filter((unit) => unit.status === "running").length;
  const failedUnits = units.filter((unit) => unit.status === "failed").length;
  const successfulUnits = completedUnits;
  const terminalUnits = completedUnits + failedUnits;
  const vadSilenceUnits = units.filter(
    (unit) => unit.status === "completed" && unit.outputStatus === "vad_silence",
  ).length;
  const speechUnits = units.filter((unit) => unit.commonVad?.hasSpeech).length;
  const speechWithOutputUnits = units.filter(
    (unit) =>
      unit.status === "completed" &&
      unit.commonVad?.hasSpeech &&
      unit.outputStatus === "normal" &&
      unit.segmentCount > 0,
  ).length;
  const emptyOutputOnSpeechUnits = units.filter(
    (unit) => unit.commonVad?.hasSpeech && unit.outputStatus === "empty_output_on_speech",
  ).length;
  const repetitionLoopCount = units.filter((unit) =>
    unit.anomalyTypes?.includes("repetition_loop"),
  ).length;
  const abnormalOutputCount = units.filter(
    (unit) =>
      unit.outputStatus === "abnormal_output" ||
      unit.outputStatus === "repetition_loop" ||
      unit.anomalyTypes?.length,
  ).length;
  const totalSpeechMs = units.reduce(
    (sum, unit) => sum + (unit.commonVad?.hasSpeech ? unit.commonVad.speechDurationMs : 0),
    0,
  );
  const coveredSpeechMs = units.reduce(
    (sum, unit) =>
      sum +
      (unit.status === "completed" &&
      unit.outputStatus === "normal" &&
      unit.segmentCount > 0 &&
      unit.commonVad?.hasSpeech
        ? unit.commonVad.speechDurationMs
        : 0),
    0,
  );
  const taskProgressPercent = units.length > 0 ? (terminalUnits / units.length) * 100 : 0;
  const processedPercent = audioDurationMs > 0 ? (processedAudioMs / audioDurationMs) * 100 : 0;
  const processedSpeechPercent =
    scheduledSpeechMs > 0 ? (processedAudioMs / scheduledSpeechMs) * 100 : 0;
  const speechRatioPercent =
    audioDurationMs > 0 ? Math.min(100, (scheduledSpeechMs / audioDurationMs) * 100) : 0;
  const speechCoveragePercent =
    totalSpeechMs > 0 ? (coveredSpeechMs / totalSpeechMs) * 100 : speechUnits === 0 ? 100 : 0;
  const allCompleted =
    units.length > 0 && completedUnits === units.length && pendingUnits === 0 && runningUnits === 0;
  const last = [...units].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const resourceSamples = units.flatMap((unit) => (unit.resourceUsage ? [unit.resourceUsage] : []));
  const maximumDefined = (values: Array<number | undefined>): number | undefined => {
    const defined = values.filter((value): value is number => value !== undefined);
    return defined.length ? Math.max(...defined) : undefined;
  };
  const resourceUsage = resourceSamples.length
    ? {
        device: resourceSamples.find((sample) => sample.device)?.device,
        backend: resourceSamples.find((sample) => sample.backend)?.backend,
        quantization: resourceSamples.find((sample) => sample.quantization)?.quantization,
        dtype: resourceSamples.find((sample) => sample.dtype)?.dtype,
        modelFileSizeBytes: fallback?.resourceUsage?.modelFileSizeBytes,
        gpuMemoryBeforeLoadMb: resourceSamples[0]?.gpuMemoryBeforeLoadMb,
        gpuMemoryAfterLoadMb: [...resourceSamples]
          .reverse()
          .find((sample) => sample.gpuMemoryAfterLoadMb !== undefined)?.gpuMemoryAfterLoadMb,
        gpuPeakMemoryMb: maximumDefined(resourceSamples.map((sample) => sample.gpuPeakMemoryMb)),
        gpuMemoryAfterReleaseMb: fallback?.resourceUsage?.gpuMemoryAfterReleaseMb,
        ramPeakMb: maximumDefined(resourceSamples.map((sample) => sample.ramPeakMb)),
        oomCount: units.filter((unit) => /oom|out of memory/iu.test(unit.errorMessage ?? ""))
          .length,
        workerCrashCount: units.filter((unit) =>
          /worker.*(?:crash|exit)/iu.test(unit.errorMessage ?? ""),
        ).length,
        resourceReleaseSucceeded: fallback?.resourceUsage?.resourceReleaseSucceeded,
        possibleResourceLeak: fallback?.resourceUsage?.possibleResourceLeak,
      }
    : fallback?.resourceUsage;
  return {
    audioDurationMs,
    processedAudioMs: units.length > 0 ? processedAudioMs : fallback?.processedAudioMs || 0,
    coveredAudioMs: units.length > 0 ? coveredAudioMs : fallback?.coveredAudioMs || 0,
    totalUnits: units.length,
    completedUnits,
    pendingUnits,
    runningUnits,
    failedUnits,
    retryCount: units.reduce((sum, unit) => sum + Math.max(0, unit.retryCount), 0),
    segmentCount: transcript.length,
    speakerCount: new Set(transcript.map((segment) => segment.speakerId)).size,
    successfulUnits,
    silenceUnits: vadSilenceUnits,
    vadSilenceUnits,
    speechUnits,
    speechWithOutputUnits,
    emptyOutputOnSpeechUnits,
    repetitionLoopCount,
    abnormalOutputCount,
    hallucinationSuspectedCount: abnormalOutputCount,
    taskProgressPercent,
    scheduledSpeechMs,
    processedSpeechPercent,
    speechRatioPercent,
    processedPercent,
    speechCoveragePercent,
    finalResultSaved: allCompleted ? fallback?.finalResultSaved : false,
    terminationReason:
      failedUnits > 0
        ? "partial"
        : allCompleted
          ? "completed"
          : fallback?.terminationReason === "completed" ||
              fallback?.terminationReason === "no_speech"
            ? undefined
            : fallback?.terminationReason,
    lastErrorStage: [...units].reverse().find((unit) => unit.errorCode)?.stage,
    inferenceElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.inferenceTimeMs ?? 0), 0),
    conversionElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.conversionTimeMs ?? 0), 0),
    loadElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.loadTimeMs ?? 0), 0),
    alignmentElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.alignmentTimeMs ?? 0), 0),
    saveElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.saveTimeMs ?? 0), 0),
    releaseElapsedMs: fallback?.releaseElapsedMs,
    totalElapsedMs: units.reduce(
      (sum, unit) => sum + (unit.timing?.totalTimeMs ?? 0) + (unit.timing?.saveTimeMs ?? 0),
      0,
    ),
    resourceUsage,
    lastChunkOffsetMs: last?.startMs,
    lastHeartbeatAt: last?.heartbeatAt ?? fallback?.lastHeartbeatAt,
  };
};

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

const durationMs = async (
  filePath: string,
): Promise<{ durationMs: number; inputFormat?: string }> =>
  new Promise((resolve, reject) => {
    const executable = resolveFfmpegExecutable();
    if (!executable) return reject(new Error("ffmpeg_missing"));
    const child: ChildProcessWithoutNullStreams = spawn(
      executable,
      ["-nostdin", "-hide_banner", "-i", filePath],
      { windowsHide: true },
    );
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (value: string) => (output += value));
    child.on("error", (error) =>
      reject(new Error("ffmpeg_probe_failed: " + (error instanceof Error ? error.message : error))),
    );
    child.stdin.end();
    child.on("close", () => {
      // FFmpeg emits this fixed header in bounded local diagnostic output.
      // eslint-disable-next-line security/detect-unsafe-regex
      const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
      const seconds = match
        ? Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])
        : Number.NaN;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        const detail = output.trim().slice(-500);
        return reject(new Error(detail || "recording_duration_unavailable"));
      }
      const audioLine = output.match(/Audio:\s*([^\r\n]+)/i)?.[1]?.trim();
      resolve({ durationMs: Math.round(seconds * 1_000), inputFormat: audioLine });
    });
  });

const createTaskId = (recordingId: string): string =>
  `voice-memory:${recordingId}:${Date.now()}-${randomUUID().slice(0, 8)}`;

const emptyRecord = (request: VoiceMemoryProcessRequest): VoiceMemoryRecord => ({
  schemaVersion: 1,
  recordingId: request.recordingId,
  filePath: request.filePath,
  roomId: request.roomId,
  roomName: request.roomName,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  phase: "idle",
  progress: 0,
  speakers: [],
  transcript: [],
  summary: [],
  chapters: [],
  highlights: [],
  markerTitles: (request.markers ?? []).map((marker) => ({
    markerId: marker.id,
    offsetMs: marker.offsetMs,
    title: `标记 ${Math.round(marker.offsetMs / 1_000)} 秒`,
  })),
  timeline: (request.markers ?? []).map((marker) => ({
    id: marker.id,
    kind: "marker" as const,
    offsetMs: marker.offsetMs,
    title: `标记 ${Math.round(marker.offsetMs / 1_000)} 秒`,
  })),
});

export const applySpeakingTimeline = (
  record: VoiceMemoryRecord,
  observations: VoiceMemorySpeakingObservation[],
): VoiceMemoryRecord => {
  if (!observations.length) return record;
  const updates = new Map<
    string,
    { memberId: string; nickname: string; confidence: "high" | "medium" }
  >();
  for (const speakerId of new Set(record.transcript.map((segment) => segment.speakerId))) {
    const scores = new Map<string, { memberId: string; nickname: string; count: number }>();
    for (const segment of record.transcript.filter((item) => item.speakerId === speakerId)) {
      for (const observation of observations) {
        if (
          observation.offsetMs < segment.startMs - 350 ||
          observation.offsetMs > segment.endMs + 350
        )
          continue;
        const current = scores.get(observation.memberId);
        scores.set(observation.memberId, {
          memberId: observation.memberId,
          nickname: observation.nickname,
          count: (current?.count ?? 0) + 1,
        });
      }
    }
    const ranked = [...scores.values()].sort((left, right) => right.count - left.count);
    const total = ranked.reduce((sum, item) => sum + item.count, 0);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || total === 0) continue;
    const share = best.count / total;
    if (share < 0.62 || (second && best.count < second.count * 1.45)) continue;
    updates.set(speakerId, {
      memberId: best.memberId,
      nickname: best.nickname,
      confidence: share >= 0.78 ? "high" : "medium",
    });
  }
  return {
    ...record,
    speakers: record.speakers.map((speaker) => ({
      ...speaker,
      ...(updates.get(speaker.speakerId) ?? {}),
    })),
    transcript: record.transcript.map((segment) => ({
      ...segment,
      ...(updates.get(segment.speakerId) ?? {}),
    })),
  };
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

/** Runs resumable transcription and organization while persisting every completed unit. */
export class AiVoiceMemoryService {
  private readonly listeners = new Set<(record: VoiceMemoryRecord) => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pendingProcesses = new Map<string, Promise<VoiceMemoryRecord>>();
  private readonly requestVersions = new Map<string, number>();
  private readonly deletedRecordings = new Set<string>();
  private processingQueue: Promise<void> = Promise.resolve();
  private manualQueue: Promise<void> = Promise.resolve();
  private manualRequestVersion = 0;
  private activeManual?: {
    recordingId: string;
    operation: Promise<VoiceMemoryRecord>;
  };
  private activeAutomatic?: {
    recordingId: string;
    operation: Promise<VoiceMemoryRecord>;
    organizing: boolean;
  };
  private activeQuestionController?: AbortController;
  private lastTask?: VoiceMemoryTaskDiagnostic;
  private deferredRetryTimer?: NodeJS.Timeout;

  constructor(
    private readonly models: AiModelManager,
    private readonly runtime: AiRuntimeManager,
    private readonly textGateway: AiTextGateway,
    private readonly store: VoiceMemoryStore,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
    private readonly isAutomaticTranscriptionEnabled: () => boolean = () => true,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    const records = await this.store.list();
    this.lastTask = records
      .filter((record) => record.diagnostic)
      .sort((left, right) =>
        (right.diagnostic?.updatedAt ?? "").localeCompare(left.diagnostic?.updatedAt ?? ""),
      )[0]?.diagnostic;
    const recoverableFfmpegFailures = records.filter(isRecoverableFfmpegFailure);
    if (recoverableFfmpegFailures.length > 0 && resolveFfmpegExecutable()) {
      for (const record of recoverableFfmpegFailures) {
        await this.save({
          ...record,
          phase: "paused",
          taskStatus: "pending",
          processingStage: "preprocess",
          diagnostic: record.diagnostic
            ? {
                ...record.diagnostic,
                status: "pending",
                updatedAt: new Date().toISOString(),
                errorCode: undefined,
                errorMessage: undefined,
              }
            : undefined,
          errorMessage: undefined,
        });
      }
      this.log("info", "Recoverable FFmpeg voice-memory failures reset", {
        recordingIds: recoverableFfmpegFailures.map((record) => record.recordingId),
      });
    }
    const interrupted = records.filter(
      (record) =>
        record.phase === "transcribing" ||
        record.phase === "organizing" ||
        record.transcriptionUnits?.some((unit) => unit.status === "running") ||
        record.organization?.status === "running" ||
        record.organization?.chunks.some((chunk) => chunk.status === "running"),
    );
    for (const record of interrupted) {
      await this.save({
        ...record,
        transcriptionUnits: record.transcriptionUnits?.map((unit) =>
          unit.status === "running"
            ? {
                ...unit,
                status: "pending",
                stage: undefined,
                heartbeatAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : unit,
        ),
        organization: record.organization
          ? {
              ...record.organization,
              status: record.organization.status === "completed" ? "completed" : "paused",
              chunks: record.organization.chunks.map((chunk) =>
                chunk.status === "running"
                  ? { ...chunk, status: "pending", updatedAt: new Date().toISOString() }
                  : chunk,
              ),
              metrics: record.organization.metrics
                ? { ...record.organization.metrics, interrupted: true }
                : record.organization.metrics,
              updatedAt: new Date().toISOString(),
            }
          : undefined,
        phase: "paused",
        taskStatus: "pending",
        diagnostic: record.diagnostic
          ? {
              ...record.diagnostic,
              status: "pending",
              updatedAt: new Date().toISOString(),
              errorMessage: undefined,
            }
          : undefined,
        errorMessage: undefined,
      });
    }
    this.models.onStatus(() => this.scheduleDeferredRetry());
    this.scheduleDeferredRetry();
  }

  onStatus(listener: (record: VoiceMemoryRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getRuntimeStatus(): Promise<AiRuntimeStatus> {
    // CUDA/PyTorch discovery is deliberately lazy. Starting the desktop app in manual
    // transcription mode must not launch a Python worker just to populate the AI settings UI.
    await this.refreshRuntimeStatus();
    const status = await this.runtime.status();
    return { ...status, lastTask: this.lastTask };
  }

  async get(recordingId: string): Promise<VoiceMemoryRecord | undefined> {
    const record = await this.store.get(recordingId);
    return record ? this.withTranscriptionModel(record) : undefined;
  }

  async list(): Promise<VoiceMemoryRecord[]> {
    return (await this.store.list()).map((record) => this.withTranscriptionModel(record));
  }

  search(request: VoiceMemorySearchRequest): VoiceMemorySearchResult[] {
    return this.store.search(request);
  }

  pause(recordingId: string): void {
    this.controllers.get(recordingId)?.abort();
  }

  hasActiveTask(): boolean {
    return Boolean(
      this.activeManual ||
      this.activeAutomatic ||
      this.pendingProcesses.size > 0 ||
      [...this.controllers.values()].some((controller) => !controller.signal.aborted),
    );
  }

  pauseAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  /** Clears one comparison run without deleting the recording file or its user markers. */
  async clearTranscriptionResults(recordingId: string): Promise<VoiceMemoryRecord> {
    if (this.pendingProcesses.has(recordingId)) throw new Error("voice_memory_task_active");
    const record = await this.requireRecord(recordingId);
    this.requestVersions.set(recordingId, (this.requestVersions.get(recordingId) ?? 0) + 1);
    this.controllers.delete(recordingId);
    await Promise.all([
      ...Object.keys(AI_ASR_MODEL_NAMES).map((modelId) =>
        this.models.clearTaskCheckpoint(`transcription:${recordingId}:${modelId}`),
      ),
      this.models.clearTaskCheckpoint(`transcription:${recordingId}`),
    ]);
    if (this.lastTask?.taskId.includes(recordingId)) this.lastTask = undefined;
    return this.save({
      ...record,
      phase: "idle",
      progress: 0,
      taskId: undefined,
      taskStatus: undefined,
      processingStage: undefined,
      diagnostic: undefined,
      organizedAt: undefined,
      transcriptionPipelineVersion: undefined,
      transcriptionModel: undefined,
      transcriptionVariants: undefined,
      transcriptionElapsedMs: undefined,
      transcriptionStats: undefined,
      transcriptionUnits: undefined,
      transcriptionBenchmark: undefined,
      errorMessage: undefined,
      speakers: [],
      transcript: [],
      summary: [],
      chapters: [],
      highlights: [],
      timeline: record.timeline.filter((entry) => entry.kind === "marker"),
      organization: undefined,
      organizationPublication: undefined,
    });
  }

  async markOrganizationPublished(
    recordingId: string,
    publication: VoiceMemoryOrganizationPublication,
  ): Promise<VoiceMemoryRecord> {
    const record = await this.requireRecord(recordingId);
    if (record.organization?.status !== "completed" || !record.organization.finalResult) {
      throw new Error("voice_memory_organization_required");
    }
    return this.save({ ...record, organizationPublication: publication });
  }

  cancelQuestion(): boolean {
    if (!this.activeQuestionController || this.activeQuestionController.signal.aborted)
      return false;
    this.activeQuestionController.abort();
    return true;
  }

  async delete(recordingId: string): Promise<void> {
    this.deletedRecordings.add(recordingId);
    this.requestVersions.set(recordingId, (this.requestVersions.get(recordingId) ?? 0) + 1);
    this.controllers.get(recordingId)?.abort();
    const pending = this.pendingProcesses.get(recordingId);
    if (pending) {
      await Promise.race([
        pending.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
      ]);
    }
    this.pendingProcesses.delete(recordingId);
    this.controllers.delete(recordingId);
    await this.store.delete(recordingId);
  }

  async reconcileRecordingIdentity(
    legacyRecordingId: string,
    recordingId: string,
    filePath: string,
    markers: Array<{ id: string; offsetMs: number }> = [],
  ): Promise<void> {
    const stable = await this.store.get(recordingId);
    const legacy =
      legacyRecordingId !== recordingId ? await this.store.get(legacyRecordingId) : undefined;
    const record = stable ?? legacy;
    if (!record) return;
    const activeIds = new Set([legacyRecordingId, recordingId]);
    const running = [...activeIds].some((id) => this.pendingProcesses.has(id));
    for (const id of activeIds) {
      this.requestVersions.set(id, (this.requestVersions.get(id) ?? 0) + 1);
      this.controllers.get(id)?.abort();
    }
    await Promise.all(
      [...activeIds].map(async (id) => {
        const pending = this.pendingProcesses.get(id);
        if (!pending) return;
        await Promise.race([
          pending.catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
        ]);
      }),
    );
    const migrated = await this.store.save({
      ...record,
      recordingId,
      filePath,
      transcript: record.transcript.map((segment) => ({ ...segment, recordingId })),
      markerTitles: record.markerTitles.map((marker) => {
        const current = markers.find((candidate) => candidate.offsetMs === marker.offsetMs);
        return current ? { ...marker, markerId: current.id } : marker;
      }),
      phase: running ? "paused" : record.phase,
    });
    if (legacy && legacyRecordingId !== recordingId) await this.store.delete(legacyRecordingId);
    if (running) {
      void this.start({
        recordingId,
        filePath,
        roomId: migrated.roomId,
        roomName: migrated.roomName,
        manual: true,
        organize: true,
      });
    }
  }

  async resume(recordingId: string): Promise<VoiceMemoryRecord> {
    const record = await this.store.get(recordingId);
    if (!record) throw new Error("voice_memory_not_found");
    const resumeOrganization =
      record.processingStage === "organize" &&
      record.transcript.length > 0 &&
      !hasInvalidVoiceMemoryResult(record);
    return this.start({
      recordingId,
      filePath: record.filePath,
      roomId: record.roomId,
      roomName: record.roomName,
      manual: true,
      transcribe: !resumeOrganization,
      organize: resumeOrganization,
      asrModelId: record.transcriptionModel?.id,
    });
  }

  async selectTranscriptionVariant(
    recordingId: string,
    modelId: AiAsrModelId,
  ): Promise<VoiceMemoryRecord> {
    const record = await this.requireRecord(recordingId);
    const variant = record.transcriptionVariants?.[modelId];
    if (!variant) throw new Error("voice_memory_transcription_variant_not_found");
    return this.save({
      ...record,
      transcript: variant.transcript,
      speakers: variant.speakers,
      transcriptionModel: variant.model,
      transcriptionPipelineVersion: variant.pipelineVersion,
      transcriptionElapsedMs: variant.transcriptionElapsedMs,
      transcriptionStats: variant.transcriptionStats,
      transcriptionUnits: variant.transcriptionUnits,
      transcriptionBenchmark: variant.benchmark,
      phase: "ready",
      progress: 100,
      errorMessage: undefined,
    });
  }

  /** Acknowledges a UI retry immediately while the durable worker continues in the background. */
  async start(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    // A retry button can be clicked more than once while the request is waiting
    // behind another long recording. Keep the first accepted task instead of
    // replacing it with another task for the same recording.
    const pending = this.pendingProcesses.get(request.recordingId);
    if (pending) {
      const pendingRecord = await this.store.get(request.recordingId);
      const previousTaskIsTerminal =
        pendingRecord &&
        (pendingRecord.phase === "ready" ||
          pendingRecord.phase === "error" ||
          pendingRecord.phase === "paused") &&
        pendingRecord.taskStatus !== "processing";
      const startsDistinctTask =
        previousTaskIsTerminal &&
        Boolean(request.taskId && request.taskId !== pendingRecord?.taskId);
      if ((!request.restartTranscription && !startsDistinctTask) || !previousTaskIsTerminal) {
        if (pendingRecord) return pendingRecord;
      } else {
        await pending.catch(() => undefined);
        if (this.pendingProcesses.get(request.recordingId) === pending) {
          this.pendingProcesses.delete(request.recordingId);
        }
      }
    }
    const previousRecord = await this.store.get(request.recordingId);
    const previous = previousRecord ? this.withTranscriptionModel(previousRecord) : undefined;
    const taskId = request.taskId ?? createTaskId(request.recordingId);
    const queuedRequest = {
      ...request,
      taskId,
      // A manual retry is a durable resume unless the caller explicitly requests a restart.
      // Invalid/partial results are exactly the records that need their completed units kept.
      restartTranscription: request.transcribe !== false && request.restartTranscription === true,
    };
    const queued = await this.save({
      ...(previous ?? emptyRecord(queuedRequest)),
      phase: "idle",
      taskId,
      taskStatus: "pending",
      processingStage: "recording",
      diagnostic: this.createDiagnostic(queuedRequest, "pending", "recording"),
      errorMessage: undefined,
    });
    if (request.manual) {
      void this.process(queuedRequest).catch(() => undefined);
    } else {
      this.queueAutomaticProcess(queuedRequest);
    }
    return queued;
  }

  process(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    request = { ...request, taskId: request.taskId ?? createTaskId(request.recordingId) };
    this.deletedRecordings.delete(request.recordingId);
    const pending = this.pendingProcesses.get(request.recordingId);
    if (pending) {
      if (!request.restartTranscription) return pending;
      this.controllers.get(request.recordingId)?.abort();
      return pending
        .catch(() => undefined)
        .then(() => {
          if (this.pendingProcesses.get(request.recordingId) === pending) {
            this.pendingProcesses.delete(request.recordingId);
          }
          return this.process(request);
        });
    }

    const version = (this.requestVersions.get(request.recordingId) ?? 0) + 1;
    this.requestVersions.set(request.recordingId, version);
    const run = async (): Promise<VoiceMemoryRecord> => {
      if (this.requestVersions.get(request.recordingId) !== version) {
        return (await this.store.get(request.recordingId)) ?? emptyRecord(request);
      }
      return this.processNow(request);
    };

    let operation: Promise<VoiceMemoryRecord>;
    if (request.manual) {
      const manualRequestVersion = ++this.manualRequestVersion;
      const interruptedAutomatic = this.activeAutomatic?.operation;
      const interruptedManual = this.activeManual?.operation;
      if (this.activeAutomatic) {
        this.controllers.get(this.activeAutomatic.recordingId)?.abort();
      }
      if (this.activeManual) {
        this.controllers.get(this.activeManual.recordingId)?.abort();
      }
      operation = this.manualQueue
        .catch(() => undefined)
        .then(async () => {
          await Promise.all([
            interruptedAutomatic?.catch(() => undefined),
            interruptedManual?.catch(() => undefined),
          ]);
          if (manualRequestVersion !== this.manualRequestVersion) {
            const superseded = (await this.store.get(request.recordingId)) ?? emptyRecord(request);
            return this.save({
              ...superseded,
              phase: "paused",
              taskStatus: "pending",
              processingStage: "recording",
              diagnostic: this.createDiagnostic(request, "pending", "recording", {
                errorCode: "manual_task_superseded",
                errorMessage: "已暂停：已开始另一条录音的转录。",
              }),
              errorMessage: undefined,
            });
          }
          const active = run();
          this.activeManual = { recordingId: request.recordingId, operation: active };
          try {
            return await active;
          } finally {
            if (this.activeManual?.operation === active) this.activeManual = undefined;
          }
        });
      this.manualQueue = operation.then(
        () => undefined,
        () => undefined,
      );
    } else {
      operation = this.processingQueue
        .catch(() => undefined)
        .then(async () => {
          await this.manualQueue.catch(() => undefined);
          if (this.requestVersions.get(request.recordingId) !== version) {
            return (await this.store.get(request.recordingId)) ?? emptyRecord(request);
          }
          const active = run();
          this.activeAutomatic = {
            recordingId: request.recordingId,
            operation: active,
            organizing: request.organize !== false,
          };
          try {
            return await active;
          } finally {
            if (this.activeAutomatic?.operation === active) this.activeAutomatic = undefined;
          }
        });
      this.processingQueue = operation.then(
        () => undefined,
        () => undefined,
      );
    }
    this.pendingProcesses.set(request.recordingId, operation);
    void operation.then(
      () => {
        if (this.pendingProcesses.get(request.recordingId) === operation) {
          this.pendingProcesses.delete(request.recordingId);
        }
      },
      () => {
        if (this.pendingProcesses.get(request.recordingId) === operation) {
          this.pendingProcesses.delete(request.recordingId);
        }
      },
    );
    return operation;
  }

  async queueRecordings(
    recordings: Array<{
      recordingId?: string;
      filePath: string;
      fileSize?: number;
      roomId?: string;
      markers?: Array<{ id: string; offsetMs: number }>;
    }>,
    organize: boolean,
  ): Promise<void> {
    if (!this.isAutomaticTranscriptionEnabled()) return;
    for (const recording of [...recordings].sort(
      (left, right) =>
        (left.fileSize ?? Number.MAX_SAFE_INTEGER) - (right.fileSize ?? Number.MAX_SAFE_INTEGER),
    )) {
      const recordingId = recording.recordingId ?? recording.filePath;
      await this.reconcileRecordingIdentity(
        recording.filePath,
        recordingId,
        recording.filePath,
        recording.markers,
      );
      const record = await this.store.get(recordingId);
      const isCurrentTerminalResult =
        record?.phase === "ready" &&
        record.transcriptionPipelineVersion === TRANSCRIPTION_PIPELINE_VERSION;
      if (isCurrentTerminalResult || this.pendingProcesses.has(recordingId)) continue;
      const taskId = createTaskId(recordingId);
      const queuedRequest: VoiceMemoryProcessRequest = {
        recordingId,
        filePath: recording.filePath,
        roomId: recording.roomId,
        roomName: recording.roomId === "side" ? "二号房" : "一号房",
        organize,
        markers: recording.markers,
        taskId,
      };
      await this.save({
        ...(record ?? emptyRecord(queuedRequest)),
        phase: "idle",
        taskId,
        taskStatus: "pending",
        processingStage: "recording",
        diagnostic: this.createDiagnostic(queuedRequest, "pending", "recording"),
        errorMessage: undefined,
      });
      this.queueAutomaticProcess(queuedRequest);
    }
  }

  private queueAutomaticProcess(request: VoiceMemoryProcessRequest): void {
    // Readable speech always wins over an optional Qwen summary. If organization is
    // occupying the worker, keep its transcript checkpoint and yield to the new audio.
    if (this.activeAutomatic?.organizing) {
      this.controllers.get(this.activeAutomatic.recordingId)?.abort();
    }
    const transcription = this.process({ ...request, organize: false });
    if (request.organize !== false) {
      void transcription
        .then((record) => {
          if (!record.transcript.length || record.errorMessage === "no_reliable_speech") return;
          return this.process({ ...request, transcribe: false, organize: true });
        })
        .catch(() => undefined);
    } else {
      void transcription.catch(() => undefined);
    }
  }

  private async processNow(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    const taskId = request.taskId ?? createTaskId(request.recordingId);
    this.log("info", "Voice memory processing started", {
      recordingId: request.recordingId,
      taskId,
      manual: request.manual === true,
      restartTranscription: request.restartTranscription === true,
    });
    const previous = await this.store.get(request.recordingId);
    let record = previous ?? emptyRecord(request);
    if (request.benchmark) {
      const environment = await this.runtime.benchmarkEnvironment();
      const previousBenchmark = previous?.transcriptionBenchmark;
      const preservedClips =
        !request.restartTranscription && previousBenchmark?.mode === request.benchmark.mode
          ? previousBenchmark?.clips
          : undefined;
      record = {
        ...record,
        transcriptionBenchmark: {
          ...request.benchmark,
          clips: request.benchmark.clips ?? preservedClips,
          environment: {
            ...environment,
            ...request.benchmark.environment,
            pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
            adapterVersion: "desktop-asr-adapter-v1",
          },
        },
      };
    }
    let currentStage: VoiceMemoryProcessingStage = "recording";
    const shouldTranscribe = request.transcribe !== false;
    const controller = new AbortController();
    this.controllers.get(request.recordingId)?.abort();
    this.controllers.set(request.recordingId, controller);
    try {
      if (shouldTranscribe) {
        currentStage = "audio_file";
        await this.runtime.validateInputFile(request.filePath);
        record = await this.updateDiagnostic(record, request, taskId, currentStage, "processing");
        if (request.restartTranscription) {
          const restartModelId =
            request.asrModelId ?? record.transcriptionModel?.id ?? this.models.getActiveAsrModel();
          await Promise.all([
            this.models.clearTaskCheckpoint(
              `transcription:${record.recordingId}:${restartModelId}`,
            ),
            this.models.clearTaskCheckpoint(`transcription:${record.recordingId}`),
          ]);
          record = await this.save({
            ...record,
            phase: "idle",
            progress: 0,
            speakers: [],
            transcript: [],
            summary: [],
            chapters: [],
            highlights: [],
            timeline: record.timeline.filter((entry) => entry.kind === "marker"),
            transcriptionPipelineVersion: undefined,
            transcriptionModel: undefined,
            transcriptionElapsedMs: undefined,
            transcriptionStats: undefined,
            transcriptionUnits: undefined,
            transcriptionBenchmark: request.benchmark ? record.transcriptionBenchmark : undefined,
            organizedAt: undefined,
            errorMessage: undefined,
          });
        }
        if (!request.benchmark && record.transcriptionBenchmark) {
          // A saved benchmark clip is historical result metadata. A later normal transcription
          // must always use the full recording and must not inherit benchmark-only range/state.
          record = { ...record, transcriptionBenchmark: undefined };
        }
        record = await this.transcribe(
          record,
          request.manual === true,
          controller.signal,
          request.asrModelId,
          request.benchmark,
          (stage) => {
            currentStage = stage;
          },
        );
        record = applySpeakingTimeline(record, request.speakingTimeline ?? []);
      } else if (record.transcript.length === 0 || hasInvalidVoiceMemoryResult(record)) {
        throw new Error("voice_memory_transcript_required");
      }
      if (record.transcript.length === 0) {
        this.log("info", "Voice memory contained no reliable speech", {
          recordingId: record.recordingId,
        });
        const validity = evaluateVoiceMemoryTranscriptionValidity(
          record.transcriptionStats,
          record.transcriptionUnits,
        );
        const partial = !validity.complete;
        const missedSpeech = (record.transcriptionStats?.emptyOutputOnSpeechUnits ?? 0) > 0;
        return this.save({
          ...record,
          phase: "ready",
          progress: 100,
          taskId,
          taskStatus: partial ? "failed" : "success",
          processingStage: "transcript",
          diagnostic: this.createDiagnostic(request, partial ? "failed" : "success", "transcript", {
            errorCode: partial
              ? "partial_transcription"
              : missedSpeech
                ? "empty_output_on_speech"
                : "no_reliable_speech",
            errorMessage: partial
              ? "部分音频分块处理失败，未得到完整转录。"
              : missedSpeech
                ? "公共语音检测发现人声，但模型没有产生有效文字。"
                : "没有检测到可识别的人声。",
          }),
          transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
          errorMessage: partial
            ? "partial_transcription"
            : missedSpeech
              ? "empty_output_on_speech"
              : "no_reliable_speech",
        });
      }
      await this.save({
        ...record,
        taskId,
        taskStatus: "processing",
        processingStage: "transcript",
        transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
      });
      let organizationError: string | undefined;
      if (request.organize !== false) {
        try {
          currentStage = "organize";
          record = await this.organize(record, request.manual === true, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || (error as Error).message === "ai_task_paused")
            throw error;
          organizationError = error instanceof Error ? error.message : String(error);
          this.log("warn", "Voice memory organization failed; transcript retained", {
            recordingId: record.recordingId,
            reason: organizationError,
          });
        }
      }
      const transcriptionValidity = evaluateVoiceMemoryTranscriptionValidity(
        record.transcriptionStats,
        record.transcriptionUnits,
      );
      const partialTranscription = !transcriptionValidity.complete;
      record = await this.save({
        ...record,
        phase: "ready",
        progress: 100,
        taskId,
        taskStatus: organizationError || partialTranscription ? "failed" : "success",
        processingStage: organizationError ? "organize" : "storage",
        diagnostic: this.createDiagnostic(
          request,
          organizationError || partialTranscription ? "failed" : "success",
          organizationError ? "organize" : "storage",
          organizationError
            ? { errorMessage: `organize_failed:${organizationError}` }
            : partialTranscription
              ? {
                  errorCode: "partial_transcription",
                  errorMessage: "部分音频分块处理失败，可继续重试失败分块。",
                }
              : undefined,
        ),
        transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
        errorMessage: organizationError
          ? `organize_failed:${organizationError}`
          : partialTranscription
            ? "partial_transcription"
            : undefined,
      });
      this.log("info", "Voice memory processing completed", {
        recordingId: record.recordingId,
        transcriptSegments: record.transcript.length,
      });
      return record;
    } catch (error) {
      const paused = controller.signal.aborted || (error as Error).message === "ai_task_paused";
      const reason = error instanceof Error ? error.message : String(error);
      const requiresManual =
        !request.manual && reason === "automatic_long_recording_requires_manual";
      this.log(paused || requiresManual ? "info" : "error", "Voice memory processing stopped", {
        recordingId: record.recordingId,
        reason,
        paused,
      });
      const deferred =
        !request.manual &&
        !requiresManual &&
        (reason === "manual_only" ||
          reason === "waiting_for_game_to_finish" ||
          reason === "realtime_pressure" ||
          reason.startsWith("voice_") ||
          reason.startsWith("screen_share") ||
          reason.startsWith("peer_recovery") ||
          reason.startsWith("network_quality") ||
          reason.startsWith("renderer_memory"));
      // transcribe() persists every completed chunk before moving to the next one. When a later
      // chunk is paused or fails, the rejected promise cannot return that newer record object to
      // this caller. Reload the durable copy so this final status update never overwrites already
      // visible transcript segments with the stale pre-transcription snapshot.
      const durableRecord = (await this.store.get(request.recordingId)) ?? record;
      const interruptedStats = durableRecord.transcriptionStats
        ? {
            ...durableRecord.transcriptionStats,
            finalResultSaved: false,
            terminationReason: paused ? ("paused" as const) : ("failed" as const),
          }
        : undefined;
      record = await this.save({
        ...durableRecord,
        transcriptionStats: interruptedStats,
        taskId,
        taskStatus: paused || deferred || requiresManual ? "pending" : "failed",
        processingStage: currentStage,
        diagnostic: this.createDiagnostic(
          request,
          paused || deferred || requiresManual ? "pending" : "failed",
          currentStage,
          { errorCode: this.errorCode(error), errorMessage: reason },
        ),
        phase: paused || deferred || requiresManual ? "paused" : "error",
        errorMessage: requiresManual
          ? "manual_required:long_recording"
          : deferred
            ? `deferred:${reason}`
            : paused
              ? undefined
              : reason,
      });
      if (deferred) this.scheduleDeferredRetry();
      if (!paused && !deferred) throw error;
      return record;
    } finally {
      if (this.controllers.get(request.recordingId) === controller) {
        this.controllers.delete(request.recordingId);
      }
      if (request.taskId?.startsWith("model-comparison:")) {
        // A comparison run is intentionally isolated: do not leave the previous model resident
        // while the next model is waiting to load, and do not let a failed run retain its worker.
        this.runtime.releaseAsr("model_comparison_model_complete");
      }
    }
  }

  async assignSpeaker(
    recordingId: string,
    speakerId: string,
    memberId: string,
    nickname: string,
  ): Promise<VoiceMemoryRecord> {
    const record = await this.requireRecord(recordingId);
    const speakers = record.speakers.filter((speaker) => speaker.speakerId !== speakerId);
    speakers.push({ speakerId, memberId, nickname, confidence: "high", manuallyConfirmed: true });
    return this.save({
      ...record,
      speakers,
      transcript: record.transcript.map((segment) =>
        segment.speakerId === speakerId
          ? { ...segment, memberId, nickname, confidence: "high" }
          : segment,
      ),
    });
  }

  async updateMarkerTitle(
    recordingId: string,
    markerId: string,
    title: string,
  ): Promise<VoiceMemoryRecord> {
    const record = await this.requireRecord(recordingId);
    const normalized = title.trim().slice(0, 120);
    if (!normalized) throw new Error("invalid_marker_title");
    return this.save({
      ...record,
      markerTitles: record.markerTitles.map((marker) =>
        marker.markerId === markerId ? { ...marker, title: normalized, userEdited: true } : marker,
      ),
      timeline: record.timeline.map((entry) =>
        entry.kind === "marker" && entry.id === markerId ? { ...entry, title: normalized } : entry,
      ),
    });
  }

  async ask(request: VoiceMemoryQuestionRequest): Promise<VoiceMemoryAnswer> {
    const record = await this.requireRecord(request.recordingId);
    const terms = request.question
      .normalize("NFKC")
      .split(/\s+/)
      .filter((term) => term.length > 1);
    const candidates = record.transcript
      .map((segment) => ({
        segment,
        score: terms.reduce((score, term) => score + (segment.text.includes(term) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 16)
      .map(({ segment }) => segment);
    const answer = await this.runQuestion((signal) =>
      this.textGateway.generateJson<VoiceMemoryAnswer>({
        purpose: "question",
        manual: true,
        maxNewTokens: 700,
        signal,
        prompt: [
          "你是上号的本地语音记忆助手。只根据给出的录音片段回答朋友间的日常问题。",
          '返回 JSON：{"text":"回答","sources":[{"startMs":数字,"segmentId":"id","quote":"简短原话"}]}。没有依据就明确说没找到。',
          `问题：${request.question.slice(0, 500)}`,
          "片段：",
          ...candidates.map(
            (segment) =>
              `${segment.id}\t${segment.startMs}\t${segment.nickname ?? segment.speakerId}\t${segment.text}`,
          ),
        ].join("\n"),
      }),
    );
    return {
      text: String(answer.text ?? ""),
      sources: (Array.isArray(answer.sources) ? answer.sources : [])
        .map((source) => {
          const segment = candidates.find((candidate) => candidate.id === source.segmentId);
          return segment
            ? {
                startMs: segment.startMs,
                segmentId: segment.id,
                quote: String(source.quote || segment.text).slice(0, 240),
                recordingId: record.recordingId,
                filePath: record.filePath,
                roomName: record.roomName,
                createdAt: record.createdAt,
              }
            : undefined;
        })
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .slice(0, 8),
    };
  }

  async askMemory(request: VoiceMemoryGlobalQuestionRequest): Promise<VoiceMemoryAnswer> {
    const question = request.question.trim().slice(0, 500);
    if (!question) throw new Error("memory_question_required");
    const candidates = this.store.related(question, 24);
    const answer = await this.runQuestion((signal) =>
      this.textGateway.generateJson<VoiceMemoryAnswer>({
        purpose: "question",
        manual: true,
        maxNewTokens: 700,
        signal,
        prompt: [
          "你是上号房间里的中文助手。用户可能在查找朋友语音记忆，也可能在问普通问题。",
          "有相关语音记忆时优先依据它们回答，并给出来源；没有相关记忆时可以正常回答常识问题，但不要编造录音来源。",
          '只返回 JSON：{"text":"回答","sources":[{"segmentId":"memory-1","startMs":数字,"quote":"简短原话"}]}。来源编号必须取自下面的 memory-N；没有录音依据时 sources 返回空数组。',
          `问题：${question}`,
          "可能相关的本地语音记忆：",
          ...(candidates.length
            ? candidates.map(
                (item, index) =>
                  `memory-${index + 1}\t${item.roomName ?? "房间"}\t${item.createdAt}\t${item.startMs}\t${item.kind}\t${item.title}\t${item.excerpt}`,
              )
            : ["没有检索到相关语音记忆。"]),
        ].join("\n"),
      }),
    );
    return {
      text: String(answer.text ?? ""),
      sources: (Array.isArray(answer.sources) ? answer.sources : [])
        .map((source) => {
          const match = /^memory-(\d+)$/.exec(source.segmentId);
          const candidate = match
            ? candidates[Number.parseInt(match[1] ?? "0", 10) - 1]
            : undefined;
          return candidate
            ? {
                startMs: candidate.startMs,
                segmentId: source.segmentId,
                quote: String(source.quote || candidate.excerpt).slice(0, 240),
                recordingId: candidate.recordingId,
                filePath: candidate.filePath,
                roomName: candidate.roomName,
                createdAt: candidate.createdAt,
              }
            : undefined;
        })
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .slice(0, 8),
    };
  }

  private async transcribe(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
    requestedModelId?: AiAsrModelId,
    requestedBenchmark?: VoiceMemoryBenchmarkRunMetadata,
    onStage?: (stage: VoiceMemoryProcessingStage) => void,
  ): Promise<VoiceMemoryRecord> {
    const selectedModelId =
      requestedModelId ?? record.transcriptionModel?.id ?? this.models.getActiveAsrModel();
    const taskId = `transcription:${record.recordingId}:${selectedModelId}`;
    const legacyTaskId = `transcription:${record.recordingId}`;
    const modelCheckpoint = this.models.getTaskCheckpoint(taskId);
    const legacyCheckpoint = this.models.getTaskCheckpoint(legacyTaskId);
    const checkpoint =
      modelCheckpoint ??
      (legacyCheckpoint?.asrModelId === selectedModelId ? legacyCheckpoint : undefined);
    const checkpointModel =
      checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION
        ? checkpoint.asrModelId
        : undefined;
    // "Continue transcription" belongs to the recording, not to the model currently selected
    // in Settings. Pin a valid checkpoint to its original ASR so changing the default model does
    // not restart the recording or mix two recognizers in one transcript.
    const runnable = this.models.canRunTask(
      "transcription",
      manual,
      checkpointModel ?? selectedModelId,
    );
    if (!runnable.runnable) throw new Error(runnable.reason);
    const asrModelId = runnable.requiredModel as AiAsrModelId;
    const asrStatus = (await this.runtime.status(asrModelId)).asr;
    const transcriptionModel = transcriptionModelMetadata(asrModelId, asrStatus);
    onStage?.("preprocess");
    const audio = await durationMs(record.filePath);
    record = await this.updateDiagnostic(
      record,
      { recordingId: record.recordingId, filePath: record.filePath },
      record.taskId ?? createTaskId(record.recordingId),
      "preprocess",
      "processing",
      {
        inputFormat: audio.inputFormat,
        asrInputFormat: asrStatus.asrInputFormat,
        modelName: asrStatus.modelName,
        modelVersion: asrStatus.modelVersion,
        modelPath: asrStatus.modelPath,
        runtimeMessage: asrStatus.message,
      },
    );
    const activeBenchmark = requestedBenchmark ? record.transcriptionBenchmark : undefined;
    const existingBenchmarkClip = activeBenchmark?.clips?.[0];
    const {
      sourceStartMs,
      sourceEndMs,
      clipDurationMs: totalDuration,
    } = resolveTranscriptionRunRange(audio.durationMs, activeBenchmark);
    if (activeBenchmark) {
      record = {
        ...record,
        transcriptionBenchmark: {
          ...activeBenchmark,
          clips: [
            {
              ...(existingBenchmarkClip ?? {}),
              startMs: 0,
              endMs: totalDuration,
              sourceStartMs,
              sourceEndMs,
              clipLocalStartMs: 0,
              clipLocalEndMs: totalDuration,
            },
          ],
        },
      };
    }
    if (!manual && !canAutomaticallyTranscribeDuration(totalDuration)) {
      throw new Error("automatic_long_recording_requires_manual");
    }
    // Prefer speech-only clips carrying the signed-in participant identity. A twelve-hour room
    // may contain far less than twelve hours of actual speech, so this avoids repeatedly decoding
    // every participant's silence while retaining exact nicknames and overlapping speakers.
    const loadedSpeakerSegments = await loadRecordingSpeakerSegments(
      record.recordingId,
      record.filePath,
    );
    const speechSources: KnownSpeakerTranscriptionSource[] = (loadedSpeakerSegments ?? [])
      .filter((segment) => segment.startMs < sourceEndMs && segment.endMs > sourceStartMs)
      .map((segment) => {
        const clippedStartMs = Math.max(segment.startMs, sourceStartMs);
        return {
          ...segment,
          speakerId: segment.userId?.trim() || segment.speakerId,
          startMs: clippedStartMs,
          endMs: Math.min(segment.endMs, sourceEndMs),
          audioOffsetMs: Math.max(0, clippedStartMs - segment.startMs),
        };
      });
    const participantTracks = await loadRecordingParticipantTracks(
      record.recordingId,
      record.filePath,
    );
    const participantSources = participantTracks?.length
      ? splitParticipantTracksIntoSpeakerSources(
          participantTracks,
          sourceEndMs,
          TRANSCRIPTION_CHUNK_MS,
          sourceStartMs,
        )
      : [];
    const durableSourceUnits = (record.transcriptionUnits ?? []).filter(
      (unit) =>
        unit.modelId === asrModelId && unit.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION,
    );
    const durableUnitsMatch = (sources: KnownSpeakerTranscriptionSource[]): boolean =>
      durableSourceUnits.length === sources.length &&
      durableSourceUnits.every((unit, index) => {
        const source = sources[index];
        return (
          source !== undefined &&
          unit.startMs === source.startMs &&
          unit.endMs === source.endMs &&
          unit.speakerId === source.speakerId
        );
      });
    // An interrupted recording created by an older build may already have checkpoints against
    // the continuous participant tracks. Finish those exact saved units instead of silently
    // changing the unit timeline mid-run; all fresh work uses the smaller speech-only source.
    const resumeParticipantSources =
      participantSources.length > 0 &&
      ((durableSourceUnits.length > 0 &&
        durableUnitsMatch(participantSources) &&
        !durableUnitsMatch(speechSources)) ||
        (durableSourceUnits.length === 0 &&
          checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
          checkpoint.asrModelId === asrModelId &&
          checkpoint.totalUnits === participantSources.length &&
          checkpoint.totalUnits !== speechSources.length));
    const knownSpeakerSegments: KnownSpeakerTranscriptionSource[] = resumeParticipantSources
      ? participantSources
      : speechSources.length
        ? speechSources
        : participantSources;
    if (knownSpeakerSegments?.length) {
      const totalUnits = knownSpeakerSegments.length;
      const checkpointCompatible =
        checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
        checkpoint.asrModelId === asrModelId &&
        checkpoint.totalUnits === totalUnits;
      const definitions = knownSpeakerSegments.map((segment, index) => ({
        index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId,
      }));
      const durableUnits = record.transcriptionUnits?.filter(
        (unit) =>
          unit.modelId === asrModelId &&
          unit.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
          unit.index >= 0 &&
          unit.index < totalUnits,
      );
      const canResumeDurably = durableUnits?.length === totalUnits;
      if (!checkpointCompatible && !canResumeDurably && record.transcript.length > 0) {
        throw new Error(
          checkpoint ? "transcription_checkpoint_incompatible" : "transcription_checkpoint_missing",
        );
      }
      if (!checkpointCompatible && checkpoint) await this.models.clearTaskCheckpoint(taskId);
      const units = createTranscriptionUnits(
        record.recordingId,
        asrModelId,
        definitions,
        canResumeDurably ? durableUnits : undefined,
        checkpointCompatible ? Math.min(totalUnits, Math.max(0, checkpoint.completedUnits)) : 0,
      );
      let stats = statsFromTranscriptionUnits(
        totalDuration,
        units,
        record.transcript,
        record.transcriptionStats,
      );
      const completedUnits = stats.completedUnits;
      record = await this.save({
        ...record,
        phase: "transcribing",
        progress: Math.round((completedUnits / totalUnits) * 70),
        transcriptionModel,
        transcriptionUnits: units,
        transcriptionStats: stats,
        errorMessage: undefined,
      });
      for (let unit = 0; unit < totalUnits; unit += 1) {
        if (signal.aborted) throw new Error("ai_task_paused");
        const source = knownSpeakerSegments[unit];
        if (!source) continue;
        const durableUnit = units[unit];
        if (!durableUnit || durableUnit.status === "completed") continue;
        const startedAt = new Date().toISOString();
        Object.assign(durableUnit, {
          status: "running" as const,
          stage: "asr" as const,
          attempts: durableUnit.attempts + 1,
          startedAt,
          heartbeatAt: startedAt,
          updatedAt: startedAt,
        });
        onStage?.("convert");
        const asrStartedAt = performance.now();
        const duration = Math.max(1, source.endMs - source.startMs);
        const chunk = await this.transcribeChunkWithRetry(
          () =>
            this.runtime.transcribeChunk({
              modelId: asrModelId,
              recordingId: record.recordingId,
              filePath: source.filePath,
              offsetMs: source.audioOffsetMs,
              durationMs: duration,
              benchmark: Boolean(activeBenchmark),
              signal,
              resourceMode: runnable.resourceMode,
              onStage: (stage, context) => {
                onStage?.(stage);
                this.log("info", "AI speaker segment stage", {
                  taskId: record.taskId,
                  recordingId: record.recordingId,
                  speakerId: source.speakerId,
                  stage,
                  ...context,
                });
              },
            }),
          signal,
          { recordingId: record.recordingId, taskId: record.taskId, unit: unit + 1, totalUnits },
        );
        const recognized = chunk.segments;
        const chunkResult = chunk.result;
        const finishedAt = new Date().toISOString();
        const outputStatus = chunkResult?.outputStatus;
        const trustworthyCoverage =
          !chunk.failed && (outputStatus === "normal" || outputStatus === "vad_silence");
        Object.assign(durableUnit, {
          status: chunk.failed ? ("failed" as const) : ("completed" as const),
          processedAudioMs: chunk.failed ? 0 : duration,
          coveredAudioMs: trustworthyCoverage ? duration : 0,
          segmentCount: recognized.length,
          commonVad: chunkResult?.commonVad,
          outputStatus,
          anomalyTypes: chunkResult?.anomalyTypes,
          timing: chunkResult?.timing,
          resourceUsage: chunkResult?.resourceUsage,
          rawRuntimeOutput: JSON.stringify({
            segments: recognized,
            rawText: chunkResult?.rawText,
            rawOutput: chunkResult?.rawOutput,
            commonVad: chunkResult?.commonVad,
            outputStatus,
            anomalyTypes: chunkResult?.anomalyTypes,
            anomalyReasons: chunkResult?.anomalyReasons,
            rawAnomalyAttempts: chunkResult?.rawAnomalyAttempts,
          }),
          normalizedSegmentIds: recognized.map((segment) => segment.id),
          retryCount: chunk.retries,
          errorCode: chunk.errorCode,
          errorMessage: chunk.errorMessage,
          completedAt: finishedAt,
          heartbeatAt: finishedAt,
          updatedAt: finishedAt,
        });
        stats = statsFromTranscriptionUnits(totalDuration, units, record.transcript, stats);
        if (chunk.fatal) {
          record = await this.save({
            ...record,
            transcriptionUnits: units,
            transcriptionStats: stats,
            errorMessage: chunk.errorMessage,
          });
          throw new Error(chunk.errorMessage ?? "asr_runtime_fatal");
        }
        const unitSaveStartedAt = performance.now();
        const transcriptionElapsedMs =
          (record.transcriptionElapsedMs ?? 0) +
          Math.max(0, Math.round(performance.now() - asrStartedAt));
        const speakerTranscript = bindTranscriptToKnownSpeaker(
          record.recordingId,
          unit,
          source,
          recognized,
        );
        this.log("info", "Speaker segment transcribed", {
          recordingId: record.recordingId,
          speakerId: source.speakerId,
          displayNameSnapshot: source.displayNameSnapshot,
          startMs: source.startMs,
          endMs: source.endMs,
          asrModelId,
          transcriptCount: speakerTranscript.length,
        });
        const retained = record.transcript.filter(
          (segment) => !segment.id.startsWith(`${record.recordingId}-speaker-${unit}-`),
        );
        const transcript = mergeSpeakerTranscript(retained, speakerTranscript);
        const sourceBySpeaker = new Map(
          knownSpeakerSegments.map((segment) => [segment.speakerId, segment]),
        );
        record = await this.save({
          ...record,
          processingStage: "storage",
          transcriptionElapsedMs,
          transcript,
          speakers: Array.from(new Set(transcript.map((segment) => segment.speakerId))).map(
            (speakerId) => {
              const identity = sourceBySpeaker.get(speakerId);
              return {
                speakerId,
                memberId: speakerId,
                nickname: identity?.displayNameSnapshot,
                displayNameSnapshot: identity?.displayNameSnapshot,
                confidence: "high" as const,
              };
            },
          ),
          progress: Math.round(((unit + 1) / totalUnits) * 70),
          transcriptionStats: {
            ...stats,
            segmentCount: transcript.length,
            speakerCount: new Set(transcript.map((segment) => segment.speakerId)).size,
          },
          transcriptionUnits: units,
        });
        durableUnit.timing = {
          ...(durableUnit.timing ?? {}),
          saveTimeMs: Math.max(0, Math.round(performance.now() - unitSaveStartedAt)),
        };
        stats = record.transcriptionStats ?? stats;
        await this.models.saveTaskCheckpoint({
          taskId,
          recordingId: record.recordingId,
          kind: "transcription",
          completedUnits: units.filter((candidate) => candidate.status === "completed").length,
          totalUnits,
          unitDurationMs: TRANSCRIPTION_CHUNK_MS,
          pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
          asrModelId,
          updatedAt: new Date().toISOString(),
        });
      }
      this.log("info", "Speaker-aware transcription completed", {
        recordingId: record.recordingId,
        identitySource: resumeParticipantSources
          ? "participant_tracks_resume"
          : speechSources.length
            ? "speech_segments"
            : "participant_tracks",
        segmentCount: totalUnits,
        speakerCount: record.speakers.length,
        overlappingSegmentsSupported: true,
        speechSegmentsRetainedForComparison: speechSources.length > 0,
      });
      const releaseMetrics = activeBenchmark
        ? await this.runtime.releaseAsrMeasured("model_comparison_model_complete")
        : undefined;
      const terminalStats = statsFromTranscriptionUnits(
        totalDuration,
        units,
        record.transcript,
        stats,
      );
      return this.save({
        ...record,
        transcript: mergeTranscriptIntoSentences(record.transcript),
        transcriptionUnits: units,
        transcriptionStats: {
          ...terminalStats,
          finalResultSaved: true,
          segmentCount: record.transcript.length,
          speakerCount: record.speakers.length,
          lastHeartbeatAt: new Date().toISOString(),
          releaseElapsedMs: releaseMetrics?.releaseTimeMs,
          totalElapsedMs:
            (terminalStats.totalElapsedMs ?? 0) + (releaseMetrics?.releaseTimeMs ?? 0),
          resourceUsage: {
            ...(terminalStats.resourceUsage ?? {}),
            gpuMemoryAfterReleaseMb: releaseMetrics?.gpuMemoryAfterReleaseMb,
            resourceReleaseSucceeded: releaseMetrics?.resourceReleaseSucceeded,
            possibleResourceLeak:
              releaseMetrics?.gpuMemoryAfterReleaseMb !== undefined &&
              terminalStats.resourceUsage?.gpuMemoryBeforeLoadMb !== undefined
                ? releaseMetrics.gpuMemoryAfterReleaseMb >
                  terminalStats.resourceUsage.gpuMemoryBeforeLoadMb + 256
                : undefined,
          },
        },
      });
    }
    const transcriptionChunkMs =
      asrModelId === "moss-transcribe-diarize-0.9b-q8_0"
        ? MOSS_CPP_TRANSCRIPTION_CHUNK_MS
        : TRANSCRIPTION_CHUNK_MS;
    const totalUnits = Math.max(1, Math.ceil(totalDuration / transcriptionChunkMs));
    const checkpointCompatible =
      checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
      checkpoint.asrModelId === asrModelId &&
      checkpoint.totalUnits === totalUnits;
    const definitions = Array.from({ length: totalUnits }, (_, index) => ({
      index,
      startMs: sourceStartMs + index * transcriptionChunkMs,
      endMs: Math.min(sourceEndMs, sourceStartMs + (index + 1) * transcriptionChunkMs),
    }));
    const durableUnits = record.transcriptionUnits?.filter(
      (unit) =>
        unit.modelId === asrModelId &&
        unit.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
        unit.index >= 0 &&
        unit.index < totalUnits,
    );
    const canResumeDurably =
      durableUnits?.length === totalUnits &&
      durableUnits.every(
        (unit, index) =>
          unit.startMs === definitions[index]?.startMs && unit.endMs === definitions[index]?.endMs,
      );
    if (!checkpointCompatible && !canResumeDurably && record.transcript.length > 0) {
      // A non-restart request must never silently destroy a saved partial transcript. Explicit
      // "重新转录" clears both the checkpoint and transcript before entering this method.
      throw new Error(
        checkpoint ? "transcription_checkpoint_incompatible" : "transcription_checkpoint_missing",
      );
    }
    if (!checkpointCompatible && checkpoint) {
      await this.models.clearTaskCheckpoint(taskId);
    }
    const units = createTranscriptionUnits(
      record.recordingId,
      asrModelId,
      definitions,
      canResumeDurably ? durableUnits : undefined,
      checkpointCompatible
        ? completedTranscriptionUnits(checkpoint, totalUnits, transcriptionChunkMs)
        : 0,
    );
    let stats = statsFromTranscriptionUnits(
      totalDuration,
      units,
      record.transcript,
      record.transcriptionStats,
    );
    const completedUnits = stats.completedUnits;
    record = await this.save({
      ...record,
      phase: "transcribing",
      progress: Math.round((completedUnits / totalUnits) * 70),
      transcriptionModel,
      transcriptionUnits: units,
      transcriptionStats: stats,
      errorMessage: undefined,
    });
    for (let unit = 0; unit < totalUnits; unit += 1) {
      if (signal.aborted) throw new Error("ai_task_paused");
      const offsetMs = sourceStartMs + unit * transcriptionChunkMs;
      const durableUnit = units[unit];
      if (!durableUnit || durableUnit.status === "completed") continue;
      const startedAt = new Date().toISOString();
      Object.assign(durableUnit, {
        status: "running" as const,
        stage: "asr" as const,
        attempts: durableUnit.attempts + 1,
        startedAt,
        heartbeatAt: startedAt,
        updatedAt: startedAt,
      });
      onStage?.("convert");
      record = await this.updateDiagnostic(
        record,
        { recordingId: record.recordingId, filePath: record.filePath },
        record.taskId ?? createTaskId(record.recordingId),
        "convert",
        "processing",
        {
          inputFormat: audio.inputFormat,
          asrInputFormat: asrStatus.asrInputFormat,
          modelName: asrStatus.modelName,
          modelVersion: asrStatus.modelVersion,
          modelPath: asrStatus.modelPath,
        },
      );
      const duration = Math.min(transcriptionChunkMs, sourceEndMs - offsetMs);
      const asrStartedAt = performance.now();
      const chunk = await this.transcribeChunkWithRetry(
        () =>
          this.runtime.transcribeChunk({
            modelId: asrModelId,
            recordingId: record.recordingId,
            filePath: record.filePath,
            offsetMs,
            durationMs: duration,
            benchmark: Boolean(activeBenchmark),
            signal,
            resourceMode: runnable.resourceMode,
            onStage: (stage, context) => {
              onStage?.(stage);
              this.log("info", "AI pipeline stage", {
                taskId: record.taskId,
                recordingId: record.recordingId,
                stage,
                ...context,
              });
            },
          }),
        signal,
        { recordingId: record.recordingId, taskId: record.taskId, unit: unit + 1, totalUnits },
      );
      const segments = chunk.segments;
      const chunkResult = chunk.result;
      const finishedAt = new Date().toISOString();
      const outputStatus = chunkResult?.outputStatus;
      const trustworthyCoverage =
        !chunk.failed && (outputStatus === "normal" || outputStatus === "vad_silence");
      Object.assign(durableUnit, {
        status: chunk.failed ? ("failed" as const) : ("completed" as const),
        processedAudioMs: chunk.failed ? 0 : duration,
        coveredAudioMs: trustworthyCoverage ? duration : 0,
        segmentCount: segments.length,
        commonVad: chunkResult?.commonVad,
        outputStatus,
        anomalyTypes: chunkResult?.anomalyTypes,
        timing: chunkResult?.timing,
        resourceUsage: chunkResult?.resourceUsage,
        rawRuntimeOutput: JSON.stringify({
          segments,
          rawText: chunkResult?.rawText,
          rawOutput: chunkResult?.rawOutput,
          commonVad: chunkResult?.commonVad,
          outputStatus,
          anomalyTypes: chunkResult?.anomalyTypes,
          anomalyReasons: chunkResult?.anomalyReasons,
          rawAnomalyAttempts: chunkResult?.rawAnomalyAttempts,
        }),
        normalizedSegmentIds: segments.map((segment) => segment.id),
        retryCount: chunk.retries,
        errorCode: chunk.errorCode,
        errorMessage: chunk.errorMessage,
        completedAt: finishedAt,
        heartbeatAt: finishedAt,
        updatedAt: finishedAt,
      });
      stats = statsFromTranscriptionUnits(totalDuration, units, record.transcript, stats);
      if (chunk.fatal) {
        record = await this.save({
          ...record,
          transcriptionUnits: units,
          transcriptionStats: stats,
          errorMessage: chunk.errorMessage,
        });
        throw new Error(chunk.errorMessage ?? "asr_runtime_fatal");
      }
      const unitSaveStartedAt = performance.now();
      const transcriptionElapsedMs =
        (record.transcriptionElapsedMs ?? 0) +
        Math.max(0, Math.round(performance.now() - asrStartedAt));
      onStage?.("storage");
      this.log("info", "Voice memory chunk transcribed", {
        recordingId: record.recordingId,
        unit: unit + 1,
        totalUnits,
        segmentCount: segments.length,
      });
      const retained = record.transcript.filter(
        (segment) =>
          segment.startMs < offsetMs || segment.startMs >= offsetMs + transcriptionChunkMs,
      );
      const transcript = [...retained, ...segments].sort(
        (left, right) => left.startMs - right.startMs,
      );
      record = await this.save({
        ...record,
        processingStage: "storage",
        transcriptionElapsedMs,
        transcript,
        speakers: Array.from(new Set(transcript.map((segment) => segment.speakerId))).map(
          (speakerId) =>
            record.speakers.find((speaker) => speaker.speakerId === speakerId) ?? {
              speakerId,
              confidence: "pending" as const,
            },
        ),
        progress: Math.round(((unit + 1) / totalUnits) * 70),
        transcriptionStats: {
          ...stats,
          segmentCount: transcript.length,
          speakerCount: new Set(transcript.map((segment) => segment.speakerId)).size,
        },
        transcriptionUnits: units,
      });
      durableUnit.timing = {
        ...(durableUnit.timing ?? {}),
        saveTimeMs: Math.max(0, Math.round(performance.now() - unitSaveStartedAt)),
      };
      stats = record.transcriptionStats ?? stats;
      await this.models.saveTaskCheckpoint({
        taskId,
        recordingId: record.recordingId,
        kind: "transcription",
        completedUnits: units.filter((candidate) => candidate.status === "completed").length,
        totalUnits,
        unitDurationMs: transcriptionChunkMs,
        pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
        asrModelId,
        updatedAt: new Date().toISOString(),
      });
      if (legacyCheckpoint?.asrModelId === asrModelId) {
        await this.models.clearTaskCheckpoint(legacyTaskId);
      }
    }
    const releaseMetrics = activeBenchmark
      ? await this.runtime.releaseAsrMeasured("model_comparison_model_complete")
      : undefined;
    const terminalStats = statsFromTranscriptionUnits(
      totalDuration,
      units,
      record.transcript,
      stats,
    );
    return this.save({
      ...record,
      transcript: mergeTranscriptIntoSentences(record.transcript),
      transcriptionUnits: units,
      transcriptionStats: {
        ...terminalStats,
        finalResultSaved: true,
        segmentCount: record.transcript.length,
        speakerCount: record.speakers.length,
        lastHeartbeatAt: new Date().toISOString(),
        releaseElapsedMs: releaseMetrics?.releaseTimeMs,
        totalElapsedMs: (terminalStats.totalElapsedMs ?? 0) + (releaseMetrics?.releaseTimeMs ?? 0),
        resourceUsage: {
          ...(terminalStats.resourceUsage ?? {}),
          gpuMemoryAfterReleaseMb: releaseMetrics?.gpuMemoryAfterReleaseMb,
          resourceReleaseSucceeded: releaseMetrics?.resourceReleaseSucceeded,
          possibleResourceLeak:
            releaseMetrics?.gpuMemoryAfterReleaseMb !== undefined &&
            terminalStats.resourceUsage?.gpuMemoryBeforeLoadMb !== undefined
              ? releaseMetrics.gpuMemoryAfterReleaseMb >
                terminalStats.resourceUsage.gpuMemoryBeforeLoadMb + 256
              : undefined,
        },
      },
    });
  }

  private async transcribeChunkWithRetry(
    operation: () => Promise<TranscriptionChunkRuntimeResult>,
    signal: AbortSignal,
    context: { recordingId: string; taskId?: string; unit: number; totalUnits: number },
  ): Promise<{
    segments: VoiceMemoryTranscriptSegment[];
    result?: TranscriptionChunkRuntimeResult;
    retries: number;
    failed: boolean;
    fatal?: boolean;
    errorCode?: string;
    errorMessage?: string;
  }> {
    let retries = 0;
    let lastError: unknown;
    let anomalyRetryUsed = false;
    const rawAnomalyAttempts: NonNullable<TranscriptionChunkRuntimeResult["rawAnomalyAttempts"]> =
      [];
    for (let attempt = 0; attempt < MAX_TRANSCRIPTION_CHUNK_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw new Error("ai_task_paused");
      try {
        const result = await operation();
        const anomalous =
          result.outputStatus === "repetition_loop" || result.outputStatus === "abnormal_output";
        if (anomalous) {
          rawAnomalyAttempts.push({
            outputStatus: result.outputStatus as "repetition_loop" | "abnormal_output",
            rawText: result.rawText,
            rawOutput: result.rawOutput,
            anomalyTypes: result.anomalyTypes,
            anomalyReasons: result.anomalyReasons,
          });
        }
        if (anomalous && !anomalyRetryUsed) {
          anomalyRetryUsed = true;
          retries += 1;
          continue;
        }
        return {
          result: {
            ...result,
            anomalyTypes: Array.from(
              new Set([
                ...rawAnomalyAttempts.flatMap((attempt) => attempt.anomalyTypes),
                ...result.anomalyTypes,
              ]),
            ),
            anomalyReasons: Array.from(
              new Set([
                ...rawAnomalyAttempts.flatMap((attempt) => attempt.anomalyReasons),
                ...result.anomalyReasons,
              ]),
            ),
            rawAnomalyAttempts: rawAnomalyAttempts.length ? rawAnomalyAttempts : undefined,
          },
          // Preserve the raw abnormal output for diagnostics, but never promote it to final text.
          segments: anomalous ? [] : result.segments,
          retries,
          failed: anomalous,
          errorCode: anomalous ? "transcription_output_anomaly" : undefined,
          errorMessage: anomalous ? result.anomalyReasons.join(",") : undefined,
        };
      } catch (error) {
        lastError = error;
        if (signal.aborted || (error as Error)?.message === "ai_task_paused") throw error;
        retries += 1;
        if (isFatalTranscriptionRuntimeFailure(error)) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.log("error", "AI transcription runtime failed deterministically; stopping model", {
            ...context,
            reason: errorMessage,
          });
          return {
            segments: [],
            retries,
            failed: true,
            fatal: true,
            errorCode: "asr_runtime_fatal",
            errorMessage,
          };
        }
        if (attempt + 1 < MAX_TRANSCRIPTION_CHUNK_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, TRANSCRIPTION_CHUNK_RETRY_DELAY_MS));
        }
      }
    }
    this.log("warn", "AI transcription chunk failed; continuing with later chunks", {
      ...context,
      reason: lastError instanceof Error ? lastError.message : String(lastError),
    });
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
    return {
      segments: [],
      retries,
      failed: true,
      errorCode: this.errorCode(lastError),
      errorMessage,
    };
  }

  private async organize(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
  ): Promise<VoiceMemoryRecord> {
    if (record.transcript.length === 0) return record;
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
      compatibleRun ? record.organization?.chunks : undefined,
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
        finalResult: compatibleRun ? record.organization?.finalResult : undefined,
        metrics,
        startedAt,
        updatedAt: new Date().toISOString(),
      },
    });

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
          status: "failed" as const,
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
            status: signal.aborted ? "paused" : "failed",
            chunks,
            metrics,
            updatedAt: new Date().toISOString(),
          },
          errorMessage: signal.aborted ? undefined : `organize_failed:${message}`,
        });
        throw lastError instanceof Error ? lastError : new Error(message);
      }
    }

    const chunkResults = chunks
      .map((chunk) => chunk.result)
      .filter((result): result is VoiceMemoryOrganizationResult => Boolean(result));
    let finalResult: VoiceMemoryOrganizationResult | undefined;
    let finalError: unknown;
    let reductionLevel = 0;
    let reductionResults = chunkResults;
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
          for (let attempt = 0; attempt < MAX_ORGANIZATION_ATTEMPTS_PER_RUN; attempt += 1) {
            if (signal.aborted) throw new Error("ai_task_paused");
            try {
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
              reduced = normalizeOrganizationResult(generation.value, record);
              break;
            } catch (error) {
              groupError = error;
              if (
                signal.aborted ||
                (error instanceof Error && error.message === "ai_task_paused")
              ) {
                throw error;
              }
              if (attempt + 1 < MAX_ORGANIZATION_ATTEMPTS_PER_RUN) {
                metrics = { ...metrics, retryCount: metrics.retryCount + 1 };
              }
            }
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
          status: paused ? "paused" : "failed",
          completedChunks: chunks.filter((chunk) => chunk.status === "completed").length,
          chunks,
          metrics,
          updatedAt: new Date().toISOString(),
        },
        errorMessage: paused ? undefined : `organize_failed:${message}`,
      });
      throw finalError instanceof Error ? finalError : new Error(message);
    }
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
    const result = await this.textGateway.generateJson<OrganizedResult>({
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
    });
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

  private async refreshRuntimeStatus(): Promise<void> {
    const statuses = await this.runtime.modelRuntimeStatuses();
    // One runtime scan used to emit one full renderer snapshot per model. Batch the result so
    // opening AI settings produces a single state update instead of a burst of 10+ renders.
    const batchRuntimeStatuses = this.models.setRuntimeStatuses?.bind(this.models);
    if (batchRuntimeStatuses) {
      batchRuntimeStatuses(statuses);
      return;
    }

    // Compatibility for older embedders and narrow test doubles. The shipped manager always
    // provides the batched method above.
    for (const [modelId, status] of Object.entries(statuses)) {
      this.models.setRuntimeStatus(modelId as AiModelId, status.ready, status.message);
    }
  }

  private scheduleDeferredRetry(): void {
    if (this.deferredRetryTimer) clearTimeout(this.deferredRetryTimer);
    if (!this.isAutomaticTranscriptionEnabled()) {
      this.deferredRetryTimer = undefined;
      return;
    }
    this.deferredRetryTimer = setTimeout(() => {
      this.deferredRetryTimer = undefined;
      void this.retryDeferredRecords();
    }, 9_000);
  }

  private async retryDeferredRecords(): Promise<void> {
    if (!this.isAutomaticTranscriptionEnabled()) return;
    if (this.controllers.size > 0) return this.scheduleDeferredRetry();
    const runnable = this.models.canRunTask("transcription", false);
    if (!runnable.runnable) return;
    const records = await this.store.list();
    for (const record of records.filter((item) => item.errorMessage?.startsWith("deferred:"))) {
      await this.process({
        recordingId: record.recordingId,
        filePath: record.filePath,
        roomId: record.roomId,
        roomName: record.roomName,
        organize: true,
      }).catch(() => undefined);
    }
  }

  private async requireRecord(recordingId: string): Promise<VoiceMemoryRecord> {
    const record = await this.store.get(recordingId);
    if (!record) throw new Error("voice_memory_not_found");
    return this.withTranscriptionModel(record);
  }

  private async runQuestion<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.activeQuestionController) throw new Error("ai_question_in_progress");
    const controller = new AbortController();
    this.activeQuestionController = controller;
    try {
      return await operation(controller.signal);
    } finally {
      if (this.activeQuestionController === controller) this.activeQuestionController = undefined;
    }
  }

  private withTranscriptionModel(record: VoiceMemoryRecord): VoiceMemoryRecord {
    if (record.transcriptionModel || record.transcript.length === 0) return record;
    const modelId =
      Object.values(record.transcriptionVariants ?? {})[0]?.model.id ??
      this.models.getTaskCheckpoint(`transcription:${record.recordingId}`)?.asrModelId;
    return modelId
      ? {
          ...record,
          transcriptionModel: {
            id: modelId,
            name: AI_ASR_MODEL_NAMES[modelId],
          },
        }
      : record;
  }

  private createDiagnostic(
    request: Pick<VoiceMemoryProcessRequest, "recordingId" | "filePath" | "taskId">,
    status: VoiceMemoryTaskStatus,
    stage: VoiceMemoryProcessingStage,
    patch?: Partial<VoiceMemoryTaskDiagnostic>,
  ): VoiceMemoryTaskDiagnostic {
    return {
      taskId: request.taskId ?? createTaskId(request.recordingId),
      status,
      stage,
      fileName: path.basename(request.filePath),
      updatedAt: new Date().toISOString(),
      ...patch,
    };
  }

  private async updateDiagnostic(
    record: VoiceMemoryRecord,
    request: Pick<VoiceMemoryProcessRequest, "recordingId" | "filePath" | "taskId">,
    taskId: string,
    stage: VoiceMemoryProcessingStage,
    status: VoiceMemoryTaskStatus,
    patch?: Partial<VoiceMemoryTaskDiagnostic>,
  ): Promise<VoiceMemoryRecord> {
    const diagnostic = this.createDiagnostic({ ...request, taskId }, status, stage, patch);
    this.lastTask = diagnostic;
    this.log("info", "AI pipeline stage", {
      taskId,
      recordingId: request.recordingId,
      stage,
      status,
      fileName: diagnostic.fileName,
      inputFormat: diagnostic.inputFormat,
      asrInputFormat: diagnostic.asrInputFormat,
    });
    return this.save({
      ...record,
      taskId,
      taskStatus: status,
      processingStage: stage,
      diagnostic,
    });
  }

  private errorCode(error: unknown): string {
    return classifyLocalModelRuntimeError(error);
  }

  private async save(record: VoiceMemoryRecord): Promise<VoiceMemoryRecord> {
    if (this.deletedRecordings.has(record.recordingId)) throw new Error("voice_memory_deleted");
    const persisted = record.transcriptionModel
      ? {
          ...record,
          transcriptionVariants: {
            ...record.transcriptionVariants,
            [record.transcriptionModel.id]: {
              model: record.transcriptionModel,
              transcript: record.transcript,
              speakers: record.speakers,
              pipelineVersion:
                record.transcriptionPipelineVersion ?? TRANSCRIPTION_PIPELINE_VERSION,
              transcriptionElapsedMs: record.transcriptionElapsedMs,
              transcriptionStats: record.transcriptionStats,
              transcriptionUnits: record.transcriptionUnits,
              benchmark: record.transcriptionBenchmark,
              updatedAt: new Date().toISOString(),
            },
          },
        }
      : record;
    const saved = await this.store.save(persisted);
    if (saved.diagnostic) this.lastTask = saved.diagnostic;
    this.log("info", "AI pipeline stage", {
      taskId: saved.taskId,
      recordingId: saved.recordingId,
      stage: saved.processingStage ?? "storage",
      status: saved.taskStatus,
      storage: "success",
    });
    for (const listener of this.listeners) listener(saved);
    return saved;
  }

  private log(
    level: RendererLogPayload["level"],
    message: string,
    context: Record<string, unknown>,
  ): void {
    void this.writeLog?.({ category: "app", level, message, context }).catch(() => undefined);
  }
}
