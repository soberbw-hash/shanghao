import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";

import { InputDevicePicker } from "../audio/InputDevicePicker";
import { OutputDevicePicker } from "../audio/OutputDevicePicker";
import { Button } from "../base/Button";
import { SegmentedControl } from "../base/SegmentedControl";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const AudioSettingsCard = ({
  settings,
  inputDevices,
  outputDevices,
  isMicTesting,
  micTestLevel,
  onToggleMicTest,
  onChange,
}: {
  settings: AppSettings;
  inputDevices: AudioDeviceDescriptor[];
  outputDevices: AudioDeviceDescriptor[];
  isMicTesting: boolean;
  micTestLevel: number;
  onToggleMicTest: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="音频" description="设备、降噪、说话模式和试音都放在这里。">
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
      <SettingsItemRow label="试音" description="会回放到当前输出设备，建议戴耳机测试。">
        <div className="min-w-[280px] space-y-3">
          <Button variant={isMicTesting ? "danger" : "secondary"} onClick={onToggleMicTest}>
            {isMicTesting ? "停止试音" : "开始试音"}
          </Button>
          <div className="h-2 overflow-hidden rounded-full bg-[#E9EEF5]">
            <div
              className="h-full rounded-full bg-[#4DA3FF] transition-[width] duration-150"
              style={{ width: `${Math.max(6, micTestLevel * 100)}%` }}
            />
          </div>
        </div>
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
