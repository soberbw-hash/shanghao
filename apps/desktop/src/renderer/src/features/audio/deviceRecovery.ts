import { AudioDeviceState } from "@private-voice/shared";

interface DeviceSelectionSnapshot {
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  inputDevices: readonly { id: string }[];
  outputDevices: readonly { id: string }[];
  inputState: AudioDeviceState;
  outputState: AudioDeviceState;
}

/** A failed enumeration is unknown availability, not proof that a device was unplugged. */
export const missingPreferredAudioDevices = ({
  preferredInputDeviceId,
  preferredOutputDeviceId,
  inputDevices,
  outputDevices,
  inputState,
  outputState,
}: DeviceSelectionSnapshot): { missingInput: boolean; missingOutput: boolean } => ({
  missingInput:
    inputState !== AudioDeviceState.Failed &&
    Boolean(preferredInputDeviceId) &&
    !inputDevices.some((device) => device.id === preferredInputDeviceId),
  missingOutput:
    outputState !== AudioDeviceState.Failed &&
    Boolean(preferredOutputDeviceId) &&
    !outputDevices.some((device) => device.id === preferredOutputDeviceId),
});

type OutputDevice = { id: string; label: string };

/** A changed selection, failed enumeration or label refresh is not a disconnect. */
export const headphoneOutputDisconnected = ({
  previous,
  previousPreference,
  currentPreference,
  outputDevices,
  outputState,
}: {
  previous?: OutputDevice;
  previousPreference?: string;
  currentPreference?: string;
  outputDevices: readonly OutputDevice[];
  outputState: AudioDeviceState;
}): boolean => {
  if (
    !previous ||
    previousPreference !== currentPreference ||
    outputState !== AudioDeviceState.Ready ||
    !/headphones?|headsets?|耳机/i.test(previous.label)
  )
    return false;
  if (previous.id !== "default") return !outputDevices.some((device) => device.id === previous.id);
  // Chromium's "default" is an alias: a different default alone does not prove
  // unplugging if the old physical device remains available in the list.
  const label = previous.label
    .replace(/^(default|默认)\s*[-–:]\s*/i, "")
    .trim()
    .toLowerCase();
  if (outputDevices.some((device) => !device.label.trim())) return false;
  return (
    Boolean(label) && !outputDevices.some((device) => device.label.trim().toLowerCase() === label)
  );
};

export const createDeviceRefreshVersion = () => {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (version: number) => version === latest,
  };
};
