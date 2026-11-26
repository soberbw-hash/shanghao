import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";

import { InputDevicePicker } from "../audio/InputDevicePicker";
import { OutputDevicePicker } from "../audio/OutputDevicePicker";
import { ShortcutInput } from "../base/ShortcutInput";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";
import { PhoneModeSettings } from "./PhoneModeSettings";
import { AudioPresetShortcutSettings } from "./AudioPresetShortcutSettings";

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
  <SettingsSection title="音频" description="选择输入与输出设备。">
    <div className="audio-settings space-y-3">
      <PhoneModeSettings />
      <AudioPresetShortcutSettings />
      <SettingsItemRow label="输入设备">
        <div className="audio-settings-device-picker">
          <InputDevicePicker
            devices={inputDevices}
            value={settings.preferredInputDeviceId}
            onChange={(preferredInputDeviceId) => onChange({ preferredInputDeviceId })}
          />
        </div>
      </SettingsItemRow>
      <SettingsItemRow label="输出设备">
        <div className="audio-settings-device-picker">
          <OutputDevicePicker
            devices={outputDevices}
            value={settings.preferredOutputDeviceId}
            onChange={(preferredOutputDeviceId) => onChange({ preferredOutputDeviceId })}
          />
        </div>
      </SettingsItemRow>
      <SettingsItemRow
        label="精彩时刻录制"
        description="录音中按一下，在录音旁生成可直接阅读的精彩时刻文本。"
      >
        <ShortcutInput
          value={settings.recordingMarkerShortcut}
          onChange={(recordingMarkerShortcut) => onChange({ recordingMarkerShortcut })}
          defaultValue="F8"
          compact
        />
      </SettingsItemRow>
      <SettingsItemRow
        label="自动录音"
        description="两人同房时开始，独处满五分钟或离开房间时保存。"
      >
        <Switch
          ariaLabel="自动录音"
          isChecked={settings.isAutoRecordOnJoinEnabled}
          onChange={(isAutoRecordOnJoinEnabled) => onChange({ isAutoRecordOnJoinEnabled })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
