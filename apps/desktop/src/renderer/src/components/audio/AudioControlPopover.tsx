import { useEffect, useState } from "react";

import { Volume2 } from "lucide-react";
import { motion } from "framer-motion";

import type { AudioDeviceDescriptor } from "@private-voice/shared";

import { Slider } from "../base/Slider";
import { Switch } from "../base/Switch";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";

interface AudioControlPopoverProps {
  title: string;
  devices: AudioDeviceDescriptor[];
  deviceId?: string;
  volume: number;
  min: number;
  max: number;
  onDeviceChange: (deviceId?: string) => void;
  onVolumePreview: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
  onTest?: () => void;
  onReset: () => void;
  autoGainEnabled?: boolean;
  onAutoGainChange?: (enabled: boolean) => void;
  noiseSuppressionEnabled?: boolean;
  isNoiseSuppressionSwitching?: boolean;
  onNoiseSuppressionChange?: (enabled: boolean) => void;
  echoCancellationEnabled?: boolean;
  onEchoCancellationChange?: (enabled: boolean) => void;
  voiceEnhancementEnabled?: boolean;
  onVoiceEnhancementChange?: (enabled: boolean) => void;
}

export const AudioControlPopover = ({
  title,
  devices,
  deviceId,
  volume,
  min,
  max,
  onDeviceChange,
  onVolumePreview,
  onVolumeCommit,
  onTest,
  onReset,
  autoGainEnabled,
  onAutoGainChange,
  noiseSuppressionEnabled,
  isNoiseSuppressionSwitching,
  onNoiseSuppressionChange,
  echoCancellationEnabled,
  onEchoCancellationChange,
  voiceEnhancementEnabled,
  onVoiceEnhancementChange,
}: AudioControlPopoverProps) => {
  const [draftVolume, setDraftVolume] = useState(volume);
  useEffect(() => setDraftVolume(volume), [volume]);

  const commit = () => onVolumeCommit(draftVolume);
  const hasMicrophoneProcessing =
    typeof noiseSuppressionEnabled === "boolean" ||
    typeof autoGainEnabled === "boolean" ||
    typeof echoCancellationEnabled === "boolean" ||
    typeof voiceEnhancementEnabled === "boolean";
  const deviceSelect = (
    <select
      value={deviceId || ""}
      aria-label={`${title}设备`}
      onChange={(event) => onDeviceChange(event.currentTarget.value || undefined)}
    >
      <option value="">系统默认</option>
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.label || title}
        </option>
      ))}
    </select>
  );

  return (
    <motion.div
      className="audio-control-popover"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionDuration.fast, ease: motionEase.standard }}
    >
      <div className="audio-control-popover-heading">
        <strong>{title}</strong>
        <span>{Math.round(draftVolume * 100)}%</span>
      </div>
      {hasMicrophoneProcessing ? null : deviceSelect}
      {typeof noiseSuppressionEnabled === "boolean" && onNoiseSuppressionChange ? (
        <div
          className="audio-control-processing-option"
          data-audio-setting="noise-suppression"
          aria-busy={isNoiseSuppressionSwitching}
        >
          <span>
            <strong>降噪</strong>
            <small>{isNoiseSuppressionSwitching ? "正在切换" : "减少环境噪声"}</small>
          </span>
          <Switch
            isChecked={noiseSuppressionEnabled}
            isDisabled={isNoiseSuppressionSwitching}
            ariaLabel="切换降噪"
            onChange={(enabled) => {
              if (!isNoiseSuppressionSwitching) onNoiseSuppressionChange(enabled);
            }}
          />
        </div>
      ) : null}
      {typeof echoCancellationEnabled === "boolean" && onEchoCancellationChange ? (
        <div className="audio-control-processing-option" data-audio-setting="echo-cancellation">
          <span>
            <strong>回声消除</strong>
            <small>减少扬声器声音回传</small>
          </span>
          <Switch
            isChecked={Boolean(echoCancellationEnabled)}
            isDisabled={isNoiseSuppressionSwitching}
            ariaLabel="切换回声消除"
            onChange={onEchoCancellationChange}
          />
        </div>
      ) : null}
      {typeof voiceEnhancementEnabled === "boolean" && onVoiceEnhancementChange ? (
        <div className="audio-control-processing-option" data-audio-setting="voice-enhancement">
          <span>
            <strong>人声增强</strong>
            <small>让说话更清楚</small>
          </span>
          <Switch
            isChecked={voiceEnhancementEnabled}
            isDisabled={isNoiseSuppressionSwitching}
            ariaLabel="切换人声增强"
            onChange={onVoiceEnhancementChange}
          />
        </div>
      ) : null}
      {typeof autoGainEnabled === "boolean" && onAutoGainChange ? (
        <div className="audio-control-processing-option" data-audio-setting="auto-gain">
          <span>
            <strong>自动增益</strong>
            <small>自动平衡说话音量</small>
          </span>
          <Switch
            isChecked={autoGainEnabled}
            ariaLabel="切换自动增益"
            onChange={onAutoGainChange}
          />
        </div>
      ) : null}
      {hasMicrophoneProcessing ? deviceSelect : null}
      <div className="audio-control-popover-slider">
        <Slider
          min={min}
          max={max}
          step={0.05}
          value={draftVolume}
          referenceValue={1}
          snapThreshold={0.05}
          aria-label={`${title}音量`}
          onChange={(event) => {
            const nextVolume = Number(event.currentTarget.value);
            setDraftVolume(nextVolume);
            onVolumePreview(nextVolume);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </div>
      <div className="audio-control-popover-actions">
        {onTest ? (
          <button type="button" className="audio-control-test" onClick={onTest}>
            <Volume2 aria-hidden="true" />
            播放测试音
          </button>
        ) : null}
        <button type="button" className="audio-control-reset" onClick={onReset}>
          恢复 100%
        </button>
      </div>
    </motion.div>
  );
};
