import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";
import type { MicTestPhase } from "../../hooks/useMicTest";

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
  micTestPhase,
  isMicClipping,
  micTestError,
  onToggleMicTest,
  onPlaySystemCapture,
  onPlayProcessed,
  onChange,
}: {
  settings: AppSettings;
  inputDevices: AudioDeviceDescriptor[];
  outputDevices: AudioDeviceDescriptor[];
  isMicTesting: boolean;
  micTestLevel: number;
  micTestPhase: MicTestPhase;
  isMicClipping: boolean;
  micTestError?: string;
  onToggleMicTest: () => void;
  onPlaySystemCapture: () => void;
  onPlayProcessed: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
}) => {
  const micHealth = !isMicTesting
    ? micTestError || "录制 9 秒后，可对比系统采集与上号处理后的声音"
    : isMicClipping
      ? "输入过高，已经出现削波"
      : micTestLevel > 0.18
        ? "麦克风正常"
        : micTestLevel > 0.035
          ? "声音有点小"
          : "听不到你";

  return (
    <SettingsSection title="音频" description="选择设备并确认麦克风状态。">
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
        <SettingsItemRow label="麦克风体检" description={micHealth}>
          <div className="min-w-[280px] space-y-3">
            <div className="flex gap-2">
              <Button variant={isMicTesting ? "danger" : "secondary"} onClick={onToggleMicTest}>
                {micTestPhase === "recording" ? "停止录制" : "重新录制 9 秒"}
              </Button>
              {micTestPhase === "ready" || micTestPhase.startsWith("playing_") ? (
                <>
                  <Button variant="ghost" onClick={onPlaySystemCapture}>
                    播放系统采集
                  </Button>
                  <Button variant="secondary" onClick={onPlayProcessed}>
                    播放上号处理后
                  </Button>
                </>
              ) : null}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#E9EEF5]">
              <div
                className={`h-full w-full origin-left rounded-full transition-transform duration-150 ${isMicClipping ? "bg-[#E5484D]" : "bg-[#4DA3FF]"}`}
                style={{ transform: `scaleX(${Math.max(0.06, micTestLevel)})` }}
              />
            </div>
          </div>
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
};
