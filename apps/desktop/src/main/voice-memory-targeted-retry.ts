import type { VoiceMemoryTranscriptionUnit } from "@private-voice/shared";

export const MAX_TRANSCRIPTION_UNIT_ATTEMPTS = 3;

/** Reopens only explicitly requested durable units and never grants a fresh retry budget. */
export function prepareTargetedTranscriptionRetry(
  units: readonly VoiceMemoryTranscriptionUnit[],
  requestedIds: readonly string[],
): { units: VoiceMemoryTranscriptionUnit[]; retryIds: ReadonlySet<string> } {
  if (
    !requestedIds.length ||
    requestedIds.length > 128 ||
    new Set(requestedIds).size !== requestedIds.length
  )
    throw new Error("transcription_retry_selection_invalid");
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  for (const id of requestedIds) {
    const unit = byId.get(id);
    if (!unit || (unit.status !== "completed" && unit.status !== "failed"))
      throw new Error("transcription_retry_unit_unavailable");
    if (unit.attempts >= MAX_TRANSCRIPTION_UNIT_ATTEMPTS)
      throw new Error("transcription_retry_budget_exhausted");
  }
  const retryIds = new Set(requestedIds);
  return {
    retryIds,
    units: units.map((unit) =>
      retryIds.has(unit.unitId)
        ? {
            ...unit,
            status: "pending",
            stage: undefined,
            coveredAudioMs: 0,
            errorCode: undefined,
            errorMessage: undefined,
            completedAt: undefined,
            updatedAt: new Date().toISOString(),
          }
        : unit,
    ),
  };
}
