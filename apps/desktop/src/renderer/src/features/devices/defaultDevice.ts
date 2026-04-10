import type { AudioDeviceDescriptor } from "@private-voice/shared";

export const pickPreferredDevice = (
  devices: AudioDeviceDescriptor[],
  preferredDeviceId?: string,
): AudioDeviceDescriptor | undefined =>
  devices.find((device) => device.id === preferredDeviceId) ??
  devices.find((device) => device.isDefault) ??
  devices[0];
