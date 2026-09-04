import { useEffect, useRef, useState } from "react";

import { Volume2 } from "lucide-react";
import { motion } from "framer-motion";

import type { AudioDeviceDescriptor } from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import { Button } from "../base/Button";
import { SegmentedControl } from "../base/SegmentedControl";
import { ShortcutInput } from "../base/ShortcutInput";
import { Slider } from "../base/Slider";
import { Switch } from "../base/Switch";
import { popoverSurfaceVariants, reducedFadeVariants } from "../../features/motion/motionPresets";
import type { MicTestPhase } from "../../hooks/useMicTest";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

export interface MicrophoneTestControls {
  phase: MicTestPhase;
  level: number;
  isClipping: boolean;
  error?: string;
  onToggle: () => void;
  onPlaySystemCapture: () => void;
  onPlayProcessed: () => void;
}

interface AudioControlPopoverProps {
  isOpen?: boolean;
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
  pushToTalkEnabled?: boolean;
  pushToTalkShortcut?: string;
  onPushToTalkEnabledChange?: (enabled: boolean) => void;
  onPushToTalkShortcutChange?: (shortcut: string) => void;
  microphoneTest?: MicrophoneTestControls;
  loudnessBalanceEnabled?: boolean;
  onLoudnessBalanceChange?: (enabled: boolean) => void;
}

export const AudioControlPopover = ({
  isOpen = true,
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
  pushToTalkEnabled,
  pushToTalkShortcut,
  onPushToTalkEnabledChange,
  onPushToTalkShortcutChange,
  microphoneTest,
  loudnessBalanceEnabled,
  onLoudnessBalanceChange,
}: AudioControlPopoverProps) => {
  const [draftVolume, setDraftVolume] = useState(volume);
  const popoverRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  useEffect(() => setDraftVolume(volume), [volume]);

  const commit = () => onVolumeCommit(draftVolume);
  const hasMicrophoneProcessing =
    typeof noiseSuppressionEnabled === "boolean" ||
    typeof autoGainEnabled === "boolean" ||
    typeof echoCancellationEnabled === "boolean" ||
    typeof voiceEnhancementEnabled === "boolean";
  const hasSpeakingMode =
    typeof pushToTalkEnabled === "boolean" &&
    Boolean(onPushToTalkEnabledChange) &&
    Boolean(onPushToTalkShortcutChange);
  const canPlayMicTest =
    microphoneTest?.phase === "ready" || microphoneTest?.phase.startsWith("playing_");
  const micTestStatus = (() => {
    if (!microphoneTest) return undefined;
    if (microphoneTest.error) return microphoneTest.error;
    if (microphoneTest.phase === "ready") return "体检完成，可以试听对比";
    if (microphoneTest.phase === "playing_system") return "正在播放原声";
    if (microphoneTest.phase === "playing_processed") return "正在播放处理后声音";
    if (microphoneTest.phase !== "recording") return "录制 5 秒，听听处理前后的区别";
    if (microphoneTest.isClipping) return "输入过高，已经出现削波";
    if (microphoneTest.level > 0.18) return "麦克风正常";
    if (microphoneTest.level > 0.035) return "声音有点小";
    return "听不到你";
  })();
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
      ref={popoverRef}
      className={cn("audio-control-popover", hasMicrophoneProcessing && "is-microphone")}
      variants={reduceMotion ? reducedFadeVariants : popoverSurfaceVariants}
      initial="initial"
      animate={isOpen ? "open" : "closed"}
      aria-hidden={!isOpen}
      style={{ pointerEvents: isOpen ? "auto" : "none" }}
      onAnimationStart={() => {
        if (popoverRef.current) popoverRef.current.style.willChange = "transform, opacity";
      }}
      onAnimationComplete={() => {
        if (popoverRef.current) popoverRef.current.style.willChange = "";
      }}
    >
      <div className="audio-control-popover-heading">
        <strong>{title}</strong>
        <span>{Math.round(draftVolume * 100)}%</span>
      </div>
      {typeof noiseSuppressionEnabled === "boolean" && onNoiseSuppressionChange ? (
        <div
          className="audio-control-processing-option"
          data-audio-setting="noise-suppression"
          aria-busy={isNoiseSuppressionSwitching}
        >
          <span>
            <strong>降噪</strong>
            <small>
              {isNoiseSuppressionSwitching ? "DeepFilterNet3 正在切换" : "DeepFilterNet3"}
            </small>
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
            <small>DSP 人声整形</small>
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
      {hasSpeakingMode ? (
        <section className="audio-control-section" aria-labelledby="microphone-speaking-mode">
          <div className="audio-control-section-heading">
            <strong id="microphone-speaking-mode">说话模式</strong>
          </div>
          <div className="audio-control-speaking-mode">
            <SegmentedControl
              value={pushToTalkEnabled ? "ptt" : "open"}
              options={[
                { value: "open", label: "自由麦" },
                { value: "ptt", label: "按键说话" },
              ]}
              onChange={(value) => onPushToTalkEnabledChange?.(value === "ptt")}
            />
          </div>
          {pushToTalkEnabled ? (
            <div className="audio-control-shortcut">
              <ShortcutInput
                value={pushToTalkShortcut || "Space"}
                onChange={(shortcut) => onPushToTalkShortcutChange?.(shortcut)}
                defaultValue="Space"
                compact
              />
            </div>
          ) : null}
        </section>
      ) : null}
      {microphoneTest ? (
        <section className="audio-control-section" aria-labelledby="microphone-health-check">
          <div className="audio-control-section-heading">
            <strong id="microphone-health-check">麦克风体检</strong>
            <small title={micTestStatus}>{micTestStatus}</small>
          </div>
          {microphoneTest.phase === "recording" ? (
            <div
              className="audio-control-mic-test-meter"
              role="meter"
              aria-label="麦克风输入音量"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(microphoneTest.level * 100)}
            >
              <span
                className={cn(microphoneTest.isClipping && "is-clipping")}
                style={{ transform: `scaleX(${Math.max(0.04, microphoneTest.level)})` }}
              />
            </div>
          ) : null}
          <div className="audio-control-mic-test-actions">
            <Button
              variant={microphoneTest.phase === "recording" ? "danger" : "secondary"}
              className="audio-control-mic-test-primary"
              onClick={microphoneTest.onToggle}
            >
              {microphoneTest.phase === "recording"
                ? "停止录制"
                : canPlayMicTest
                  ? "重新录制"
                  : "开始 5 秒体检"}
            </Button>
            {canPlayMicTest ? (
              <div className="audio-control-mic-test-playback">
                <Button variant="ghost" onClick={microphoneTest.onPlaySystemCapture}>
                  听原声
                </Button>
                <Button variant="ghost" onClick={microphoneTest.onPlayProcessed}>
                  听处理后
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      {typeof loudnessBalanceEnabled === "boolean" && onLoudnessBalanceChange ? (
        <div className="audio-control-processing-option" data-audio-setting="loudness-balance">
          <span>
            <strong>好友响度平衡</strong>
            <small>逐位好友平滑匹配约 -16 LUFS</small>
          </span>
          <Switch
            isChecked={loudnessBalanceEnabled}
            ariaLabel="切换好友响度平衡"
            onChange={onLoudnessBalanceChange}
          />
        </div>
      ) : null}
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
      <div className="audio-control-device-select">{deviceSelect}</div>
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
