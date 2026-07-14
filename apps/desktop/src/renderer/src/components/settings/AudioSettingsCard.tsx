import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";
import type { MicTestPhase } from "../../hooks/useMicTest";

import { MICROPHONE_EQ_FREQUENCIES } from "../../features/audio/microphoneProcessor";
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
  micTestPhase,
  isMicClipping,
  micTestError,
  onToggleMicTest,
  onAutoCalibrate,
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
  onAutoCalibrate: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
}) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(settings.inputLevelThreshold);
  const [equalizerDraft, setEqualizerDraft] = useState(settings.micEqualizerGains);
  useEffect(() => {
    setThresholdDraft(settings.inputLevelThreshold);
    setEqualizerDraft(settings.micEqualizerGains);
  }, [settings.inputLevelThreshold, settings.micEqualizerGains]);
  const micHealth =
    micTestPhase === "calibrating"
      ? "正在采集环境底噪，请保持安静"
      : !isMicTesting
        ? micTestError || "实时监听麦克风，建议佩戴耳机避免回授"
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
          label="智能降噪"
          description="本地处理风扇、键盘和环境底噪，不会上传声音。"
        >
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
        <SettingsItemRow label="麦克风体检" description={micHealth}>
          <div className="min-w-[280px] space-y-3">
            <div className="flex gap-2">
              <Button
                variant={isMicTesting ? "danger" : "secondary"}
                onClick={onToggleMicTest}
                disabled={micTestPhase === "calibrating"}
              >
                {micTestPhase === "monitoring" ? "停止实时试音" : "开始实时试音"}
              </Button>
              <Button
                variant="secondary"
                onClick={onAutoCalibrate}
                disabled={micTestPhase === "calibrating"}
              >
                {micTestPhase === "calibrating" ? "正在听环境…" : "智能校准"}
              </Button>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#E9EEF5]">
              <div
                className={`h-full w-full origin-left rounded-full transition-transform duration-150 ${isMicClipping ? "bg-[#E5484D]" : "bg-[#4DA3FF]"}`}
                style={{ transform: `scaleX(${Math.max(0.06, micTestLevel)})` }}
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
                    { value: "32000", label: "32 kHz" },
                    { value: "44100", label: "44.1 kHz" },
                    { value: "48000", label: "48 kHz" },
                  ]}
                  onChange={(preferredSampleRate) =>
                    onChange({
                      preferredSampleRate:
                        preferredSampleRate as AppSettings["preferredSampleRate"],
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
              <SettingsItemRow
                label="低频风噪抑制"
                description="四阶高通削弱风扇、桌面震动和低频轰鸣，默认标准。"
              >
                <SegmentedControl
                  value={settings.lowCutFrequency}
                  options={[
                    { value: "off", label: "关闭" },
                    { value: "90", label: "标准 90 Hz" },
                    { value: "120", label: "强力 120 Hz" },
                  ]}
                  onChange={(lowCutFrequency) =>
                    onChange({
                      lowCutFrequency: lowCutFrequency as AppSettings["lowCutFrequency"],
                    })
                  }
                />
              </SettingsItemRow>
              <SettingsItemRow label="输入阈值">
                <div className="min-w-[280px] space-y-2">
                  <Slider
                    min={0.05}
                    max={0.8}
                    step={0.01}
                    value={thresholdDraft}
                    onChange={(event) => setThresholdDraft(Number(event.currentTarget.value))}
                    onPointerUp={(event) =>
                      onChange({ inputLevelThreshold: Number(event.currentTarget.value) })
                    }
                    onKeyUp={(event) =>
                      onChange({ inputLevelThreshold: Number(event.currentTarget.value) })
                    }
                  />
                  <div className="text-xs text-[#98A2B3]">
                    当前：{Math.round(thresholdDraft * 100)}
                  </div>
                </div>
              </SettingsItemRow>
              <SettingsItemRow
                label="五段声音塑形"
                description="针对语音保留五个关键频段，0 dB 为原声。"
              >
                <div className="grid min-w-[420px] grid-cols-2 gap-x-4 gap-y-2">
                  {MICROPHONE_EQ_FREQUENCIES.map((frequency, index) => {
                    const gain = equalizerDraft[index] ?? 0;
                    const label = frequency >= 1_000 ? `${frequency / 1_000}k` : String(frequency);
                    return (
                      <label
                        key={frequency}
                        className="grid grid-cols-[34px_1fr_42px] items-center gap-2"
                      >
                        <span className="text-[11px] font-semibold text-[#667085]">{label}</span>
                        <Slider
                          min={-12}
                          max={12}
                          step={1}
                          value={gain}
                          onChange={(event) => {
                            const nextGains = [
                              ...equalizerDraft,
                            ] as AppSettings["micEqualizerGains"];
                            nextGains[index] = Number(event.currentTarget.value);
                            setEqualizerDraft(nextGains);
                          }}
                          onPointerUp={(event) => {
                            const nextGains = [
                              ...equalizerDraft,
                            ] as AppSettings["micEqualizerGains"];
                            nextGains[index] = Number(event.currentTarget.value);
                            onChange({ micEqualizerGains: nextGains });
                          }}
                          onKeyUp={(event) => {
                            const nextGains = [
                              ...equalizerDraft,
                            ] as AppSettings["micEqualizerGains"];
                            nextGains[index] = Number(event.currentTarget.value);
                            onChange({ micEqualizerGains: nextGains });
                          }}
                        />
                        <span className="text-right text-[11px] tabular-nums text-[#98A2B3]">
                          {gain > 0 ? "+" : ""}
                          {gain} dB
                        </span>
                      </label>
                    );
                  })}
                </div>
              </SettingsItemRow>
            </div>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
};
