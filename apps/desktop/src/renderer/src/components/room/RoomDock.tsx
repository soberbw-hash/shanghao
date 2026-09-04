import { useEffect, useState } from "react";
import { ChevronDown as ChevronDownData, ChevronUp as ChevronUpData } from "lucide";

import {
  RecordingEncoderState,
  RecordingState,
  type AppSettings,
  type AudioDeviceDescriptor,
} from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import { AudioControlPopover } from "../audio/AudioControlPopover";
import type { MicrophoneTestControls } from "../audio/AudioControlPopover";
import { MuteButton } from "../audio/MuteButton";
import { RecordingButton } from "../audio/RecordingButton";
import { Button } from "../base/Button";
import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";
import { MorphingIcon } from "../icons/MorphingIcon";
import {
  clearGlassPointerHighlight,
  refreshGlassPointerHighlightBounds,
  updateGlassPointerHighlight,
} from "../../features/motion/glassPointerHighlight";

type AudioPanel = "microphone" | "speaker" | undefined;

export type RoomDockSettings = Pick<
  AppSettings,
  | "preferredInputDeviceId"
  | "microphoneSendVolume"
  | "isNoiseSuppressionEnabled"
  | "isEchoCancellationEnabled"
  | "isVoiceEnhancementEnabled"
  | "isAutoGainControlEnabled"
  | "isPushToTalkEnabled"
  | "pushToTalkShortcut"
  | "micEqualizerGains"
  | "lowCutFrequency"
  | "preferredOutputDeviceId"
  | "speakerMasterVolume"
  | "isFriendLoudnessBalanceEnabled"
>;

interface RoomDockProps {
  settings?: RoomDockSettings;
  inputDevices: AudioDeviceDescriptor[];
  outputDevices: AudioDeviceDescriptor[];
  isMuted: boolean;
  isDeafened: boolean;
  isNoiseSuppressionSwitching: boolean;
  microphoneTest: MicrophoneTestControls;
  recordingState: RecordingState;
  recordingEncoderState: RecordingEncoderState;
  localScreenShareActive: boolean;
  isScreenShareStarting: boolean;
  isOverlayOpen: boolean;
  isLeaving: boolean;
  onToggleMicrophone: () => void;
  onToggleDeafen: () => void;
  onSwitchInputDevice: (deviceId?: string) => void;
  onMicrophoneVolumePreview: (volume: number) => void;
  onMicrophoneVolumeCommit: (volume: number) => void;
  onNoiseSuppressionChange: () => void;
  onEchoCancellationChange: (value: boolean) => void;
  onVoiceEnhancementChange: (value: boolean) => void;
  onAutoGainChange: (value: boolean) => void;
  onPushToTalkEnabledChange: (enabled: boolean) => void;
  onPushToTalkShortcutChange: (shortcut: string) => void;
  onResetMicrophoneVolume: () => void;
  onSwitchOutputDevice: (deviceId?: string) => void;
  onSpeakerVolumePreview: (volume: number) => void;
  onSpeakerVolumeCommit: (volume: number) => void;
  onLoudnessBalanceChange: (enabled: boolean) => void;
  onTestSpeaker: () => void;
  onResetSpeakerVolume: () => void;
  onToggleRecording: () => void;
  onToggleScreenShare: () => void;
  onToggleOverlay: () => void;
  onLeave: () => void;
}

export const RoomDock = ({
  settings,
  inputDevices,
  outputDevices,
  isMuted,
  isDeafened,
  isNoiseSuppressionSwitching,
  microphoneTest,
  recordingState,
  recordingEncoderState,
  localScreenShareActive,
  isScreenShareStarting,
  isOverlayOpen,
  isLeaving,
  onToggleMicrophone,
  onToggleDeafen,
  onSwitchInputDevice,
  onMicrophoneVolumePreview,
  onMicrophoneVolumeCommit,
  onNoiseSuppressionChange,
  onEchoCancellationChange,
  onVoiceEnhancementChange,
  onAutoGainChange,
  onPushToTalkEnabledChange,
  onPushToTalkShortcutChange,
  onResetMicrophoneVolume,
  onSwitchOutputDevice,
  onSpeakerVolumePreview,
  onSpeakerVolumeCommit,
  onLoudnessBalanceChange,
  onTestSpeaker,
  onResetSpeakerVolume,
  onToggleRecording,
  onToggleScreenShare,
  onToggleOverlay,
  onLeave,
}: RoomDockProps) => {
  const [activeAudioPanel, setActiveAudioPanel] = useState<AudioPanel>();
  const [mountedAudioPanels, setMountedAudioPanels] = useState<Set<Exclude<AudioPanel, undefined>>>(
    () => new Set(),
  );
  const prewarmAudioPanel = (panel: Exclude<AudioPanel, undefined>) => {
    setMountedAudioPanels((current) =>
      current.has(panel) ? current : new Set(current).add(panel),
    );
  };
  const toggleAudioPanel = (panel: Exclude<AudioPanel, undefined>) => {
    const willOpen = activeAudioPanel !== panel;
    if (willOpen) prewarmAudioPanel(panel);
    setActiveAudioPanel(willOpen ? panel : undefined);
  };

  useEffect(() => {
    if (!activeAudioPanel) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-audio-control-root]")) return;
      setActiveAudioPanel(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveAudioPanel(undefined);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeAudioPanel]);

  return (
    <footer
      className="voice-dock flex items-center gap-2 px-3 py-2.5"
      onPointerEnter={(event) => refreshGlassPointerHighlightBounds(event.currentTarget)}
      onPointerMove={(event) =>
        updateGlassPointerHighlight(event.currentTarget, event.clientX, event.clientY)
      }
      onPointerLeave={(event) => clearGlassPointerHighlight(event.currentTarget)}
    >
      <div className="voice-primary-controls">
        <div className="voice-segmented-control audio-control-anchor" data-audio-control-root>
          <MuteButton
            isMuted={isMuted}
            onClick={onToggleMicrophone}
            className="voice-segmented-main"
          />
          <button
            type="button"
            className={cn(
              "audio-control-trigger voice-segmented-arrow",
              activeAudioPanel === "microphone" && "is-active",
            )}
            title="麦克风设备、处理、说话模式与体检"
            aria-label="打开麦克风设备、处理、说话模式与体检"
            aria-expanded={activeAudioPanel === "microphone"}
            onPointerEnter={() => prewarmAudioPanel("microphone")}
            onFocus={() => prewarmAudioPanel("microphone")}
            onClick={() => toggleAudioPanel("microphone")}
          >
            <MorphingIcon
              icon={activeAudioPanel === "microphone" ? ChevronUpData : ChevronDownData}
              className="h-4 w-4"
              aria-hidden="true"
            />
          </button>
          {mountedAudioPanels.has("microphone") && settings ? (
            <AudioControlPopover
              isOpen={activeAudioPanel === "microphone"}
              title="麦克风"
              devices={inputDevices}
              deviceId={settings.preferredInputDeviceId}
              volume={settings.microphoneSendVolume}
              min={0.5}
              max={1.5}
              onDeviceChange={onSwitchInputDevice}
              onVolumePreview={onMicrophoneVolumePreview}
              onVolumeCommit={onMicrophoneVolumeCommit}
              noiseSuppressionEnabled={settings.isNoiseSuppressionEnabled}
              isNoiseSuppressionSwitching={isNoiseSuppressionSwitching}
              onNoiseSuppressionChange={onNoiseSuppressionChange}
              echoCancellationEnabled={settings.isEchoCancellationEnabled}
              onEchoCancellationChange={onEchoCancellationChange}
              voiceEnhancementEnabled={settings.isVoiceEnhancementEnabled}
              onVoiceEnhancementChange={onVoiceEnhancementChange}
              autoGainEnabled={settings.isAutoGainControlEnabled}
              onAutoGainChange={onAutoGainChange}
              pushToTalkEnabled={settings.isPushToTalkEnabled}
              pushToTalkShortcut={settings.pushToTalkShortcut}
              onPushToTalkEnabledChange={onPushToTalkEnabledChange}
              onPushToTalkShortcutChange={onPushToTalkShortcutChange}
              microphoneTest={microphoneTest}
              onReset={onResetMicrophoneVolume}
            />
          ) : null}
        </div>
        <div className="voice-segmented-control audio-control-anchor" data-audio-control-root>
          <Button
            variant={isDeafened ? "danger" : "ghost"}
            data-icon-motion="speaker"
            data-ui-sound="handled"
            className={cn(
              "voice-action-button-with-text voice-main-control voice-segmented-main",
              isDeafened && "voice-main-control-danger",
            )}
            onClick={onToggleDeafen}
          >
            <AnimatedControlIcon name="speaker" muted={isDeafened} className="voice-primary-icon" />
            <span className="voice-action-label">{isDeafened ? "扬声器关" : "扬声器开"}</span>
          </Button>
          <button
            type="button"
            className={cn(
              "audio-control-trigger voice-segmented-arrow",
              activeAudioPanel === "speaker" && "is-active",
            )}
            title="扬声器设备、好友响度平衡与总音量"
            aria-label="打开扬声器设备、好友响度平衡与总音量"
            aria-expanded={activeAudioPanel === "speaker"}
            onPointerEnter={() => prewarmAudioPanel("speaker")}
            onFocus={() => prewarmAudioPanel("speaker")}
            onClick={() => toggleAudioPanel("speaker")}
          >
            <MorphingIcon
              icon={activeAudioPanel === "speaker" ? ChevronUpData : ChevronDownData}
              className="h-4 w-4"
              aria-hidden="true"
            />
          </button>
          {mountedAudioPanels.has("speaker") && settings ? (
            <AudioControlPopover
              isOpen={activeAudioPanel === "speaker"}
              title="扬声器"
              devices={outputDevices}
              deviceId={settings.preferredOutputDeviceId}
              volume={settings.speakerMasterVolume}
              min={0}
              max={2}
              onDeviceChange={onSwitchOutputDevice}
              onVolumePreview={onSpeakerVolumePreview}
              onVolumeCommit={onSpeakerVolumeCommit}
              loudnessBalanceEnabled={settings.isFriendLoudnessBalanceEnabled}
              onLoudnessBalanceChange={onLoudnessBalanceChange}
              onTest={onTestSpeaker}
              onReset={onResetSpeakerVolume}
            />
          ) : null}
        </div>
      </div>
      <div className="flex-1" />
      <div className="voice-action-group voice-session-actions" aria-label="分享与录音">
        <Button
          variant={localScreenShareActive ? "secondary" : "ghost"}
          data-icon-motion="screen-share"
          className={`voice-action-button-with-text ${localScreenShareActive || isScreenShareStarting ? "screen-share-active-button" : ""}`}
          disabled={isScreenShareStarting}
          aria-pressed={localScreenShareActive}
          onClick={onToggleScreenShare}
        >
          <AnimatedControlIcon
            name="screen-share"
            active={localScreenShareActive}
            className="h-4 w-4"
          />
          <span className="voice-action-label">
            {isScreenShareStarting ? "正在开启…" : localScreenShareActive ? "正在分享" : "屏幕分享"}
          </span>
        </Button>
        <RecordingButton
          isRecording={recordingState === RecordingState.Recording}
          onClick={onToggleRecording}
          disabled={recordingEncoderState === RecordingEncoderState.Unsupported}
        />
      </div>
      <div className="voice-action-group voice-window-actions" aria-label="悬浮窗口">
        <Button
          variant={isOverlayOpen ? "secondary" : "ghost"}
          data-icon-motion="overlay"
          className={`voice-action-button-with-text ${isOverlayOpen ? "overlay-active-button" : ""}`}
          onClick={onToggleOverlay}
        >
          <AnimatedControlIcon name="overlay" active={isOverlayOpen} className="h-4 w-4" />
          <span className="voice-action-label">{isOverlayOpen ? "悬浮窗开" : "悬浮窗关"}</span>
        </Button>
      </div>
      <div className="voice-action-group voice-exit-actions" aria-label="离开房间">
        <Button
          variant="danger"
          data-icon-motion="exit"
          className="voice-action-button-with-text voice-exit-button"
          disabled={isLeaving}
          onClick={onLeave}
        >
          <AnimatedControlIcon name="exit" className="h-4 w-4" />
          <span className="voice-action-label">{isLeaving ? "退出中" : "退出"}</span>
        </Button>
      </div>
    </footer>
  );
};
