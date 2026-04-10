import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";

import { InputDevicePicker } from "../audio/InputDevicePicker";
import { OutputDevicePicker } from "../audio/OutputDevicePicker";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const AudioSettingsCard = ({
  settings,
  inputDevices,
  outputDevices,
  onChange,
}: {
  settings: AppSettings;
  inputDevices: AudioDeviceDescriptor[];
  outputDevices: AudioDeviceDescriptor[];
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="音频设备" description="设置默认输入设备、输出设备和基础降噪。">
    <div className="space-y-3">
      <SettingsItemRow label="输入设备">
        <InputDevicePicker
          devices={inputDevices}
          value={settings.preferredInputDeviceId}
          onChange={(preferredInputDeviceId) => onChange({ preferredInputDeviceId })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="输出设备">
        <OutputDevicePicker
          devices={outputDevices}
          value={settings.preferredOutputDeviceId}
          onChange={(preferredOutputDeviceId) => onChange({ preferredOutputDeviceId })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="基础降噪" description="只使用 Chromium 或系统自带的基础降噪能力。">
        <Switch
          isChecked={settings.isNoiseSuppressionEnabled}
          onChange={(isNoiseSuppressionEnabled) => onChange({ isNoiseSuppressionEnabled })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
