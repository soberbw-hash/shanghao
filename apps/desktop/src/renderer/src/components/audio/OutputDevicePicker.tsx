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
    {devices.length === 0 ? <option value="">未检测到输出设备</option> : null}
    {devices.map((device) => (
      <option key={device.id} value={device.id}>
        {device.label || "未命名扬声器"}
      </option>
    ))}
  </Select>
);
