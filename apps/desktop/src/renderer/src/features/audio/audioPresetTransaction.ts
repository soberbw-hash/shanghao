import {
  AUDIO_DEVICE_SETTING_KEYS,
  selectAudioDeviceSettings,
  type AppSettings,
  type AudioDevicePreset,
  type AudioDeviceSettings,
} from "@private-voice/shared";

interface Dependencies {
  getSettings: () => AppSettings | undefined;
  ownsRoom: () => boolean;
  ownsSettings?: () => boolean;
  validateDevices: (preset: AudioDevicePreset) => void;
  hold: () => () => void;
  save: (patch: Partial<AppSettings>) => Promise<unknown>;
  input: (deviceId?: string) => Promise<boolean>;
  output: (deviceId?: string) => Promise<void>;
  commit: (preset: AudioDevicePreset) => void;
  restoreGate: (safe: boolean) => void;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Two-device application either commits after verification or rolls back while the send gate is closed. */
export async function applyAudioDevicePreset(
  preset: AudioDevicePreset,
  deps: Dependencies,
): Promise<void> {
  deps.validateDevices(preset);
  const initial = deps.getSettings();
  if (!initial || !deps.ownsRoom()) throw Error("audio_preset_room_changed");
  const before = selectAudioDeviceSettings(initial);
  const release = deps.hold();
  let saved = false,
    safe = false;
  const check = () => {
    if (!deps.ownsRoom()) throw Error("audio_preset_room_changed");
    const current = deps.getSettings();
    if (
      !current ||
      !AUDIO_DEVICE_SETTING_KEYS.every((key) => equal(current[key], preset.audio[key]))
    )
      throw Error("audio_preset_superseded");
  };
  try {
    await deps.save(preset.audio);
    saved = true;
    check();
    await deps.output(preset.audio.preferredOutputDeviceId);
    check();
    if (!(await deps.input(preset.audio.preferredInputDeviceId)))
      throw Error("audio_preset_input_failed");
    check();
    deps.commit(preset);
    safe = true;
  } catch (error) {
    if (saved && (deps.ownsSettings?.() ?? true)) {
      const current = deps.getSettings();
      const ownAll =
        !!current &&
        AUDIO_DEVICE_SETTING_KEYS.every((key) => equal(current[key], preset.audio[key]));
      const rollback: Partial<AudioDeviceSettings> = {};
      if (current)
        for (const key of AUDIO_DEVICE_SETTING_KEYS) {
          if (equal(current[key], preset.audio[key]))
            Object.assign(rollback, { [key]: before[key] });
        }
      try {
        if (Object.keys(rollback).length) await deps.save(rollback);
        if (ownAll && deps.ownsRoom()) {
          await deps.output(before.preferredOutputDeviceId);
          if (!deps.ownsRoom()) throw Error("audio_preset_room_changed", { cause: error });
          if (!(await deps.input(before.preferredInputDeviceId)))
            throw Error("audio_preset_rollback_failed", { cause: error });
          safe = true;
        }
      } catch {
        safe = false;
      }
    } else safe = true;
    throw error;
  } finally {
    release();
    deps.restoreGate(deps.ownsRoom() && safe);
  }
}
