import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";

import { InputDevicePicker } from "../audio/InputDevicePicker";
import { OutputDevicePicker } from "../audio/OutputDevicePicker";
import { ShortcutInput } from "../base/ShortcutInput";
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
  <SettingsSection title="音频" description="选择输入与输出设备。">
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
        label="自动录音并保存"
        description="默认开启。进入频道后自动录音，退出时直接保存到录音库。"
      >
        <Switch
          isChecked={settings.isAutoRecordOnJoinEnabled}
          onChange={(isAutoRecordOnJoinEnabled) => onChange({ isAutoRecordOnJoinEnabled })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
