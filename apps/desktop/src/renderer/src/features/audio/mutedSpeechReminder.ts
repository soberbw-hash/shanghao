interface MutedSpeechObservation {
  now: number;
  scopeId: string;
  eligible: boolean;
  speechProbability?: number;
  voiceActivity?: string;
  processingMode?: string;
  remoteEchoDetected?: boolean;
}

/** Numeric local VAD evidence only; never owns capture, recording, or the send gate. */
export function createMutedSpeechReminder() {
  let startedAt: number | undefined;
  let previousAt: number | undefined;
  let scope: string | undefined;
  let remindedAt = -Infinity;
  const reset = () => {
    startedAt = previousAt = undefined;
    scope = undefined;
  };
  return {
    reset,
    observe(sample: MutedSpeechObservation): boolean {
      const { now, scopeId } = sample;
      if (!sample.eligible || !Number.isFinite(now)) {
        reset();
        return false;
      }
      if (
        scope !== scopeId ||
        (previousAt !== undefined && (now <= previousAt || now - previousAt > 750))
      )
        startedAt = undefined;
      previousAt = now;
      scope = scopeId;
      const speaking =
        sample.voiceActivity === "active" &&
        Number.isFinite(sample.speechProbability) &&
        sample.speechProbability! >= 0.8 &&
        ["near_speech", "double_talk"].includes(sample.processingMode ?? "") &&
        sample.remoteEchoDetected !== true;
      if (!speaking) {
        startedAt = undefined;
        return false;
      }
      startedAt ??= now;
      if (now - startedAt < 1500 || now - remindedAt < 60_000) return false;
      remindedAt = now;
      startedAt = undefined;
      return true;
    },
  };
}
