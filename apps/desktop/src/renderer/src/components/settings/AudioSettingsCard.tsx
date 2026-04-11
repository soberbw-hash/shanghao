import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";

import { InputDevicePicker } from "../audio/InputDevicePicker";
import { OutputDevicePicker } from "../audio/OutputDevicePicker";
import { SegmentedControl } from "../base/SegmentedControl";
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
  <SettingsSection title="音频" description="默认设备、降噪和说话模式。">
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
      <SettingsItemRow label="说话模式">
        <SegmentedControl
          value={settings.isPushToTalkEnabled ? "ptt" : "open"}
          options={[
            { value: "open", label: "自由麦" },
            { value: "ptt", label: "按键说话" },
          ]}
          onChange={(value) => onChange({ isPushToTalkEnabled: value === "ptt" })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="基础降噪" description="使用系统和 WebRTC 自带能力。">
        <Switch
          isChecked={settings.isNoiseSuppressionEnabled}
          onChange={(isNoiseSuppressionEnabled) => onChange({ isNoiseSuppressionEnabled })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
