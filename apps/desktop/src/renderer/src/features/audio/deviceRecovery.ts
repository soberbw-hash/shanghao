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

export const createDeviceRefreshVersion = () => {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (version: number) => version === latest,
  };
};
