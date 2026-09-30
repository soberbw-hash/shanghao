import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  type AiAsrModelId,
  type VoiceMemoryTranscriptionStats,
  type VoiceMemoryTranscriptionUnit,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

const TRANSCRIPTION_PIPELINE_VERSION = CURRENT_TRANSCRIPTION_PIPELINE_VERSION;

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
  const suspectedOmissionCount = units.filter(
    (unit) =>
      unit.outputStatus === "empty_output_on_speech" &&
      unit.endMs - unit.startMs >= 2_000 &&
      (unit.commonVad?.speechDurationMs ?? 0) >= 1_000 &&
      (unit.commonVad?.activeFrameRatio ?? 0) >= 0.08 &&
      (unit.commonVad?.peak ?? 0) >= 0.01,
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
        ...fallback?.resourceUsage,
        device: resourceSamples.find((sample) => sample.device)?.device,
        backend: resourceSamples.find((sample) => sample.backend)?.backend,
        quantization: resourceSamples.find((sample) => sample.quantization)?.quantization,
        dtype: resourceSamples.find((sample) => sample.dtype)?.dtype,
        modelFileSizeBytes: fallback?.resourceUsage?.modelFileSizeBytes,
        gpuMemoryBeforeLoadMb: resourceSamples.find(
          (sample) => sample.gpuMemoryBeforeLoadMb !== undefined,
        )?.gpuMemoryBeforeLoadMb,
        gpuMemoryAfterLoadMb: [...resourceSamples]
          .reverse()
          .find((sample) => sample.gpuMemoryAfterLoadMb !== undefined)?.gpuMemoryAfterLoadMb,
        gpuPeakMemoryMb: maximumDefined(resourceSamples.map((sample) => sample.gpuPeakMemoryMb)),
        gpuMemoryAfterReleaseMb: fallback?.resourceUsage?.gpuMemoryAfterReleaseMb,
        ramPeakMb: maximumDefined(resourceSamples.map((sample) => sample.ramPeakMb)),
        oomCount: units.filter((unit) =>
          /oom|out of memory/iu.test(
            [
              unit.errorMessage,
              ...(unit.attemptHistory ?? []).map((attempt) => attempt.errorMessage),
            ].join("\n"),
          ),
        ).length,
        workerCrashCount: units.filter((unit) =>
          /worker.*(?:crash|exit)/iu.test(
            [
              unit.errorMessage,
              ...(unit.attemptHistory ?? []).map((attempt) => attempt.errorMessage),
            ].join("\n"),
          ),
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
    hallucinationSuspectedCount: 0,
    suspectedOmissionCount,
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
    preflightElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.preflightTimeMs ?? 0), 0),
    resourceProbeElapsedMs: units.reduce(
      (sum, unit) => sum + (unit.timing?.resourceProbeTimeMs ?? 0),
      0,
    ),
    loadElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.loadTimeMs ?? 0), 0),
    providerImportElapsedMs: units.reduce(
      (sum, unit) => sum + (unit.timing?.providerImportTimeMs ?? 0),
      0,
    ),
    modelInitializationElapsedMs: units.reduce(
      (sum, unit) => sum + (unit.timing?.modelInitializationTimeMs ?? 0),
      0,
    ),
    workerStartupElapsedMs: units.reduce(
      (sum, unit) => sum + (unit.timing?.workerStartupTimeMs ?? 0),
      0,
    ),
    vadElapsedMs: units.reduce((sum, unit) => sum + (unit.timing?.vadTimeMs ?? 0), 0),
    postprocessElapsedMs: units.reduce(
      (sum, unit) => sum + (unit.timing?.postprocessTimeMs ?? 0),
      0,
    ),
    unaccountedElapsedMs: units.reduce(
      (sum, unit) => sum + (unit.timing?.unaccountedTimeMs ?? 0),
      0,
    ),
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
