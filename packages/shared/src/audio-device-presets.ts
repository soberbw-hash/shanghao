import type { AppSettings } from "./types/settings.types";

export const AUDIO_DEVICE_SETTING_KEYS = [
  "preferredInputDeviceId",
  "preferredOutputDeviceId",
  "microphoneSendVolume",
  "speakerMasterVolume",
  "isNoiseSuppressionEnabled",
  "isEchoCancellationEnabled",
  "isVoiceEnhancementEnabled",
  "isAutoGainControlEnabled",
  "micEqualizerGains",
  "lowCutFrequency",
  "isFriendLoudnessBalanceEnabled",
] as const;
export type AudioDeviceSettings = Pick<AppSettings, (typeof AUDIO_DEVICE_SETTING_KEYS)[number]>;
export interface AudioDevicePreset {
  slot: 0 | 1;
  name: string;
  audio: AudioDeviceSettings;
  microphoneMuted: boolean;
  speakerMuted: boolean;
}
export function selectAudioDeviceSettings(settings: AppSettings): AudioDeviceSettings {
  return Object.fromEntries(
    AUDIO_DEVICE_SETTING_KEYS.map((key) => [key, settings[key]]),
  ) as AudioDeviceSettings;
}
const finite = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

/** Strict, bounded, allowlisted profiles. No commands or Windows-default changes are stored. */
export function normalizeAudioDevicePresets(value: unknown): AudioDevicePreset[] {
  if (!Array.isArray(value) || value.length > 2) return [];
  const result: AudioDevicePreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const preset = item as AudioDevicePreset,
      audio = preset.audio;
    if (
      ![0, 1].includes(preset.slot) ||
      result.some((other) => other.slot === preset.slot) ||
      typeof preset.name !== "string" ||
      !preset.name.trim() ||
      preset.name.length > 24 ||
      [...preset.name].some((c) => c.charCodeAt(0) < 32) ||
      !audio ||
      typeof audio !== "object" ||
      typeof preset.microphoneMuted !== "boolean" ||
      typeof preset.speakerMuted !== "boolean"
    )
      continue;
    if (
      [audio.preferredInputDeviceId, audio.preferredOutputDeviceId].some(
        (id) => id !== undefined && (typeof id !== "string" || !id || id.length > 512),
      )
    )
      continue;
    if (
      !finite(audio.microphoneSendVolume, 0.5, 1.5) ||
      !finite(audio.speakerMasterVolume, 0, 2) ||
      ![
        "isNoiseSuppressionEnabled",
        "isEchoCancellationEnabled",
        "isVoiceEnhancementEnabled",
        "isAutoGainControlEnabled",
        "isFriendLoudnessBalanceEnabled",
      ].every((key) => typeof (audio as unknown as Record<string, unknown>)[key] === "boolean") ||
      !Array.isArray(audio.micEqualizerGains) ||
      audio.micEqualizerGains.length !== 5 ||
      !audio.micEqualizerGains.every((gain) => finite(gain, -12, 12)) ||
      !["off", "75", "90", "120"].includes(audio.lowCutFrequency)
    )
      continue;
    result.push({
      slot: preset.slot,
      name: preset.name.trim(),
      microphoneMuted: preset.microphoneMuted,
      speakerMuted: preset.speakerMuted,
      audio: {
        ...Object.fromEntries(AUDIO_DEVICE_SETTING_KEYS.map((key) => [key, audio[key]])),
        micEqualizerGains: [...audio.micEqualizerGains],
      } as AudioDeviceSettings,
    });
  }
  return result.sort((a, b) => a.slot - b.slot);
}
