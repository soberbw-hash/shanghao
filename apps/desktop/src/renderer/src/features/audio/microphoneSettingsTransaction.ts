import type { AppSettings } from "@private-voice/shared";

const processingKeys = [
  "isNoiseSuppressionEnabled",
  "isEchoCancellationEnabled",
  "isAutoGainControlEnabled",
  "isVoiceEnhancementEnabled",
] as const;
export type MicrophoneProcessingPatch = Partial<Pick<AppSettings, (typeof processingKeys)[number]>>;

/** Keep saved controls consistent with the graph retained after a failed switch. */
export const applyMicrophoneProcessingPatch = async (
  patch: MicrophoneProcessingPatch,
  dependencies: {
    getSettings: () => AppSettings | undefined;
    saveSettings: (patch: MicrophoneProcessingPatch) => Promise<unknown>;
    apply: () => Promise<boolean>;
  },
): Promise<boolean> => {
  const settings = dependencies.getSettings();
  if (!settings) return false;
  const previous = { ...settings };
  await dependencies.saveSettings(patch);
  const restore = async () => {
    const current = dependencies.getSettings();
    if (!current) return;
    const rollback: MicrophoneProcessingPatch = {};
    for (const key of processingKeys) {
      // A later settings change owns its value; only revert this operation.
      if (patch[key] !== undefined && current[key] === patch[key]) rollback[key] = previous[key];
    }
    if (Object.keys(rollback).length) await dependencies.saveSettings(rollback);
  };
  let applied: boolean;
  try {
    applied = await dependencies.apply();
  } catch (error) {
    await restore();
    throw error;
  }
  if (!applied) await restore();
  return applied;
};
