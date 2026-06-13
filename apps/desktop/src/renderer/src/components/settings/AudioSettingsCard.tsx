import { useState } from "react";
import { ChevronDown } from "lucide-react";

import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";

import { InputDevicePicker } from "../audio/InputDevicePicker";
import { OutputDevicePicker } from "../audio/OutputDevicePicker";
import { Button } from "../base/Button";
import { SegmentedControl } from "../base/SegmentedControl";
import { Slider } from "../base/Slider";
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
}) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

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
        <SettingsItemRow label="降噪">
          <Switch
            isChecked={settings.isNoiseSuppressionEnabled}
            onChange={(isNoiseSuppressionEnabled) => onChange({ isNoiseSuppressionEnabled })}
          />
        </SettingsItemRow>
        <SettingsItemRow label="回声消除">
          <Switch
            isChecked={settings.isEchoCancellationEnabled}
            onChange={(isEchoCancellationEnabled) => onChange({ isEchoCancellationEnabled })}
          />
        </SettingsItemRow>
        <SettingsItemRow label="自动增益">
          <Switch
            isChecked={settings.isAutoGainControlEnabled}
            onChange={(isAutoGainControlEnabled) => onChange({ isAutoGainControlEnabled })}
          />
        </SettingsItemRow>
        <SettingsItemRow label="试音" description="本地实时监听，不经过房间网络。">
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

        <div className="overflow-hidden rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/70"
            onClick={() => setIsAdvancedOpen((current) => !current)}
            aria-expanded={isAdvancedOpen}
          >
            <span>
              <span className="block text-sm font-medium text-[#111827]">高级音频</span>
              <span className="mt-0.5 block text-xs text-[#98A2B3]">一般不需要修改</span>
            </span>
            <ChevronDown
              className={`h-4 w-4 text-[#667085] transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`}
            />
          </button>

          {isAdvancedOpen ? (
            <div className="space-y-3 border-t border-[#E7ECF2] bg-white/70 p-3">
              <SettingsItemRow label="采样率" description="设备不支持时会自动回退。">
                <SegmentedControl
                  value={settings.preferredSampleRate}
                  options={[
                    { value: "auto", label: "自动" },
                    { value: "44100", label: "44.1 kHz" },
                    { value: "48000", label: "48 kHz" },
                  ]}
                  onChange={(preferredSampleRate) =>
                    onChange({
                      preferredSampleRate: preferredSampleRate as AppSettings["preferredSampleRate"],
                    })
                  }
                />
              </SettingsItemRow>
              <SettingsItemRow label="试音模式">
                <SegmentedControl
                  value={settings.micMonitorMode}
                  options={[
                    { value: "processed", label: "处理后" },
                    { value: "raw", label: "原声" },
                  ]}
                  onChange={(micMonitorMode) =>
                    onChange({ micMonitorMode: micMonitorMode as AppSettings["micMonitorMode"] })
                  }
                />
              </SettingsItemRow>
              <SettingsItemRow label="输入阈值">
                <div className="min-w-[280px] space-y-2">
                  <Slider
                    min={0.05}
                    max={0.8}
                    step={0.01}
                    value={settings.inputLevelThreshold}
                    onChange={(event) =>
                      onChange({ inputLevelThreshold: Number(event.currentTarget.value) })
                    }
                  />
                  <div className="text-xs text-[#98A2B3]">
                    当前：{settings.inputLevelThreshold.toFixed(2)}
                  </div>
                </div>
              </SettingsItemRow>
            </div>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
};
