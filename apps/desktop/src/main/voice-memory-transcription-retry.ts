import type {
  RendererLogPayload,
  VoiceMemoryTranscriptionAttempt,
  VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";
import type { TranscriptionChunkRuntimeResult } from "./asr-benchmark-runtime";
import { classifyLocalModelRuntimeError } from "./local-model-runtime";
import { waitForTask } from "./task-cancellation";
const MAX_TRANSCRIPTION_CHUNK_ATTEMPTS = 3;
const TRANSCRIPTION_CHUNK_RETRY_DELAY_MS = 1_000;
export const isFatalTranscriptionRuntimeFailure = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /(?:0xc000001d|-1073741795|3221225501|illegal instruction|ark_asr_(?:backend_missing|q8_model_missing|q8_quantization_required)|unable to compare versions for packaging|no package metadata was found|modulenotfounderror|no module named|importerror:|dll load failed)/i.test(
    message,
  );
};

export async function transcribeChunkWithRetry(
  operation: () => Promise<TranscriptionChunkRuntimeResult>,
  signal: AbortSignal,
  context: {
    recordingId: string;
    taskId?: string;
    unit: number;
    totalUnits: number;
    benchmark?: boolean;
  },
  log: (
    level: RendererLogPayload["level"],
    message: string,
    context: Record<string, unknown>,
  ) => void,
): Promise<{
  segments: VoiceMemoryTranscriptSegment[];
  result?: TranscriptionChunkRuntimeResult;
  retries: number;
  failed: boolean;
  fatal?: boolean;
  errorCode?: string;
  errorMessage?: string;
  attemptHistory: VoiceMemoryTranscriptionAttempt[];
}> {
  let retries = 0;
  let lastError: unknown;
  let anomalyRetryUsed = false;
  const measuredTimings: TranscriptionChunkRuntimeResult["timing"][] = [];
  const operationStarted = performance.now();
  const attemptHistory: VoiceMemoryTranscriptionAttempt[] = [];
  const maxAttempts = context.benchmark ? 2 : MAX_TRANSCRIPTION_CHUNK_ATTEMPTS;
  const rawAnomalyAttempts: NonNullable<TranscriptionChunkRuntimeResult["rawAnomalyAttempts"]> = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) throw new Error("ai_task_paused");
    const startedAt = new Date().toISOString();
    const attemptStarted = performance.now();
    retries = attempt;
    try {
      const result = await operation();
      // A worker may finish while its owner is being cancelled. Never commit a late result.
      if (signal.aborted) throw new Error("ai_task_paused");
      measuredTimings.push(result.timing);
      const anomalous =
        result.outputStatus === "repetition_loop" || result.outputStatus === "abnormal_output";
      attemptHistory.push({
        attempt: attempt + 1,
        startedAt,
        completedAt: new Date().toISOString(),
        outcome: anomalous ? "output_anomaly" : "success",
        outputStatus: result.outputStatus,
        elapsedMs: performance.now() - attemptStarted,
        timing: result.timing,
        rawText: context.benchmark ? result.rawText : undefined,
        rawRuntimeOutput: context.benchmark ? JSON.stringify(result.rawOutput) : undefined,
      });
      if (anomalous) {
        rawAnomalyAttempts.push({
          outputStatus: result.outputStatus as "repetition_loop" | "abnormal_output",
          rawText: result.rawText,
          rawOutput: result.rawOutput,
          anomalyTypes: result.anomalyTypes,
          anomalyReasons: result.anomalyReasons,
        });
      }
      if (anomalous && !anomalyRetryUsed && attempt + 1 < maxAttempts) {
        anomalyRetryUsed = true;
        retries += 1;
        continue;
      }
      return {
        attemptHistory,
        result: {
          ...result,
          timing: {
            ...result.timing,
            ...Object.fromEntries(
              [
                "loadTimeMs",
                "conversionTimeMs",
                "inferenceTimeMs",
                "alignmentTimeMs",
                "postprocessTimeMs",
                "vadTimeMs",
                "providerImportTimeMs",
                "modelInitializationTimeMs",
                "workerStartupTimeMs",
              ].map((key) => [
                key,
                measuredTimings.reduce(
                  (sum, timing) => sum + (timing[key as keyof typeof timing] ?? 0),
                  0,
                ),
              ]),
            ),
            totalTimeMs: performance.now() - operationStarted,
          },
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const detail = error as Error & { stderr?: string; exitCode?: number };
      attemptHistory.push({
        attempt: attempt + 1,
        startedAt,
        completedAt: new Date().toISOString(),
        outcome: "runtime_error",
        errorCode: classifyLocalModelRuntimeError(error),
        errorMessage,
        elapsedMs: performance.now() - attemptStarted,
        stderr: context.benchmark ? detail.stderr : undefined,
        exitCode: detail.exitCode,
      });
      if (isFatalTranscriptionRuntimeFailure(error)) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log("error", "AI transcription runtime failed deterministically; stopping model", {
          ...context,
          reason: errorMessage,
        });
        return {
          attemptHistory,
          segments: [],
          retries,
          failed: true,
          fatal: true,
          errorCode: "asr_runtime_fatal",
          errorMessage,
        };
      }
      if (attempt + 1 < maxAttempts) {
        await waitForTask(TRANSCRIPTION_CHUNK_RETRY_DELAY_MS, signal);
      }
    }
  }
  log("warn", "AI transcription chunk failed; continuing with later chunks", {
    ...context,
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  });
  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  return {
    attemptHistory,
    segments: [],
    retries,
    failed: true,
    errorCode: classifyLocalModelRuntimeError(lastError),
    errorMessage,
  };
}
