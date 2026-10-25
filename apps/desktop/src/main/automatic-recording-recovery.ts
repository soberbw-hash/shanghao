import type { VoiceMemoryRecord } from "@private-voice/shared";
import { isTransientRemoteTranscriptionError } from "./remote-transcription-retry";

const MAX_RECOVERY_ROUNDS = 2;
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
    ((record.remoteTranscriptionRetry?.attempts ?? 0) < MAX_RECOVERY_ROUNDS ||
      (record.transcriptionModel?.id === "siliconflow-sensevoice-small" &&
        record.remoteTranscription?.partMs !== 30000))
  );
}

/** Keep recovery bounded across restarts. Each round reuses durable completed audio parts. */
export function planAutomaticRecordingRecovery(
  record: VoiceMemoryRecord,
  reason: string,
  options: { manual?: boolean; paused: boolean; enabled: boolean; now?: number },
) {
  const previous = record.remoteTranscriptionRetry;
  if (options.paused) return { deferred: false, retry: previous };
  if (isTransientRemoteTranscriptionError(reason)) {
    const attempts = previous?.attempts ?? 0;
    if (options.enabled && attempts < MAX_RECOVERY_ROUNDS)
      return {
        deferred: true,
        retry: {
          attempts: attempts + 1,
          nextAttemptAt: (options.now ?? Date.now()) + (attempts ? 45000 : 15000),
        },
      };
    return { deferred: false, retry: previous ? { attempts } : undefined };
  }
  const deferred =
    !options.manual &&
    (reason === "manual_only" ||
      reason === "cloud_asr_key_required" ||
      reason === "custom_asr_key_required" ||
      reason === "custom_ai_not_configured" ||
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
): Promise<void> {
  if (!enabled) return;
  if (busy) return later();
  if (localBlocked) return;
  for (const record of (await list()).filter((item) =>
    item.errorMessage?.startsWith("deferred:"),
  )) {
    if (isDeferredRemoteTranscription(record) && !canResumeRemoteTranscription(record)) later();
    else await run(record).catch(() => undefined);
  }
}
