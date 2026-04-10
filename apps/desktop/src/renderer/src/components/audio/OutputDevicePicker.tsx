import type { AudioDeviceDescriptor } from "@private-voice/shared";

import { Select } from "../base/Select";

export const OutputDevicePicker = ({
  devices,
  value,
  onChange,
}: {
  devices: AudioDeviceDescriptor[];
  value?: string;
  onChange: (value: string) => void;
}) => (
  <Select value={value} onChange={(event) => onChange(event.target.value)}>
    {devices.map((device) => (
      <option key={device.id} value={device.id}>
        {device.label}
      </option>
    ))}
  </Select>
);
