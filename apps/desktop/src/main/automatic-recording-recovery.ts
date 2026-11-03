import type { VoiceMemoryRecord, OrganizationRetryState } from "@private-voice/shared";
import { isTransientRemoteTranscriptionError } from "./remote-transcription-retry";
import { isTranscriptionExecutionComplete } from "./remote-transcription";

// Keep the persisted counter readable by older clients; 2 means the slow retry tier.
const MAX_RECOVERY_COUNTER = 2;

/** Re-read at dispatch time so a stale scan cannot override a user pause or replacement. */
export async function withCurrentDeferredRecording(
  snapshot: VoiceMemoryRecord,
  read: (id: string) => Promise<VoiceMemoryRecord | undefined>,
  enabled: () => boolean,
  run: (record: VoiceMemoryRecord) => Promise<unknown>,
  additionalEligibility?: (record: VoiceMemoryRecord) => boolean,
): Promise<void> {
  const current = await read(snapshot.recordingId);
  if (
    current?.updatedAt === snapshot.updatedAt &&
    (current.errorMessage?.startsWith("deferred:") || additionalEligibility?.(current)) &&
    enabled()
  )
    await run(current);
}
export function recoverInterruptedRecording(
  record: VoiceMemoryRecord,
): VoiceMemoryRecord | undefined {
  const interrupted =
    record.phase === "transcribing" ||
    record.phase === "organizing" ||
    (record.phase !== "paused" &&
      (record.transcriptionUnits?.some((unit) => unit.status === "running") ||
        record.organization?.status === "running" ||
        record.organization?.chunks.some((chunk) => chunk.status === "running")));
  if (!interrupted) return undefined;
  return {
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
    errorMessage: "deferred:app_restarted",
  };
}
export const automaticCloudFailure = (reason: string): string => {
  if (reason === "cloud_ai_busy") return "cloud_asr_http_429";
  if (reason === "cloud_ai_provider_unavailable") return "cloud_asr_http_503";
  // Text generation uses separate error names from speech recognition. Normalize
  // only transient failures so summary/fusion recovery follows the same backoff.
  const textFailure = /^(cloud|custom)_ai_(network_error|timeout|http_(?:408|429|5\d\d))$/.exec(
    reason,
  );
  return textFailure ? `${textFailure[1]}_asr_${textFailure[2]}` : reason;
};
export function automaticFusionFailure(record: VoiceMemoryRecord): string | undefined {
  const reason = automaticCloudFailure(record.transcriptionFusion?.errorCode ?? "");
  return record.transcriptionFusion?.status === "failed" &&
    (reason === "account_session_expired" || isTransientRemoteTranscriptionError(reason))
    ? reason
    : undefined;
}
export function recoverAutomaticOrganization(
  record: VoiceMemoryRecord,
  reason: string,
  deferred: boolean,
) {
  if (
    !deferred ||
    (reason !== "account_session_expired" && !isTransientRemoteTranscriptionError(reason))
  )
    return {};
  const reset = (state: OrganizationRetryState | undefined) =>
    state && state.status !== "completed"
      ? { ...state, attempts: 0, status: "pending" as const, errorMessage: undefined }
      : state;
  return {
    organizationSinglePassRetry: reset(record.organizationSinglePassRetry),
    organization:
      record.organization && record.organization.status !== "completed"
        ? {
            ...record.organization,
            status: "paused" as const,
            reductionRetries:
              record.organization.reductionRetries &&
              Object.fromEntries(
                Object.entries(record.organization.reductionRetries).map(([key, value]) => [
                  key,
                  reset(value)!,
                ]),
              ),
            chunks: record.organization.chunks.map((chunk) =>
              chunk.status === "completed"
                ? chunk
                : { ...chunk, status: "pending" as const, attempts: 0, errorMessage: undefined },
            ),
          }
        : record.organization,
  };
}
export const isDeferredRemoteTranscription = (record: VoiceMemoryRecord): boolean =>
  record.errorMessage?.startsWith("deferred:") === true &&
  isTransientRemoteTranscriptionError(record.errorMessage.slice(9));

export function canResumeRemoteTranscription(record: VoiceMemoryRecord, now = Date.now()): boolean {
  if (record.phase === "paused")
    return (
      isDeferredRemoteTranscription(record) &&
      record.remoteTranscriptionRetry?.nextAttemptAt !== undefined &&
      record.remoteTranscriptionRetry.nextAttemptAt <= now
    );
  return (
    record.phase === "error" &&
    isTransientRemoteTranscriptionError(record.errorMessage ?? "") &&
    ((record.remoteTranscriptionRetry?.nextAttemptAt ?? 0) <= now ||
      (record.transcriptionModel?.id === "siliconflow-sensevoice-small" &&
        record.remoteTranscription?.partMs !== 30000))
  );
}

/** Persist backoff across restarts. Each round reuses durable completed audio parts. */
export function planAutomaticRecordingRecovery(
  record: VoiceMemoryRecord,
  reason: string,
  options: { manual?: boolean; paused: boolean; enabled: boolean; now?: number },
) {
  const previous = record.remoteTranscriptionRetry;
  if (options.paused) return { deferred: false, retry: previous };
  if (isTransientRemoteTranscriptionError(reason)) {
    const attempts = previous?.attempts ?? 0;
    if (options.enabled)
      return {
        deferred: true,
        retry: {
          attempts: Math.min(MAX_RECOVERY_COUNTER, attempts + 1),
          nextAttemptAt:
            (options.now ?? Date.now()) +
            (attempts === 0 ? 15000 : attempts === 1 ? 45000 : 300000),
        },
      };
    return { deferred: false, retry: previous ? { attempts } : undefined };
  }
  const deferred =
    !options.manual &&
    (reason === "manual_only" ||
      reason === "cloud_asr_key_required" ||
      reason === "cloud_asr_not_configured" ||
      reason === "cloud_asr_backend_upgrade_required" ||
      reason === "account_session_expired" ||
      reason === "custom_asr_key_required" ||
      reason === "custom_ai_not_configured" ||
      reason === "cloud_ai_not_configured" ||
      /^model_.+_(?:not_installed|runtime_not_ready)$/.test(reason) ||
      reason === "waiting_for_game_to_finish" ||
      reason === "realtime_pressure" ||
      /^(?:voice_|screen_share|peer_recovery|network_quality|renderer_memory)/.test(reason));
  return { deferred, retry: previous };
}

/** Drain due work serially; leave future deadlines and explicit pauses intact. */
export async function retryDeferredRecordings(
  enabled: boolean,
  busy: boolean,
  localBlocked: boolean,
  list: () => Promise<VoiceMemoryRecord[]>,
  run: (record: VoiceMemoryRecord) => Promise<unknown>,
  later: () => void,
  assist?: (record: VoiceMemoryRecord) => "ready" | "waiting" | undefined,
): Promise<void> {
  if (!enabled) return;
  if (busy) return later();
  let assistAdmitted = false;
  for (const record of (await list()).filter(
    (item) => item.errorMessage?.startsWith("deferred:") || assist?.(item),
  )) {
    const assistState = assist?.(record);
    if (assistState === "waiting" || (assistState && assistAdmitted)) {
      later();
      continue;
    }
    if (assistState) assistAdmitted = true;
    // Text-only recovery does not require the selected local speech model.
    if (localBlocked && !isTranscriptionExecutionComplete(record)) {
      // Resource pressure can disappear without a model-status event. Keep the
      // deferred task eligible for a later check instead of abandoning it.
      later();
      continue;
    }
    if (isDeferredRemoteTranscription(record) && !canResumeRemoteTranscription(record)) later();
    else await run(record).catch(() => later());
    if (assistState) later(); // One bounded recheck verifies completion or a renewed resource wait.
  }
}
