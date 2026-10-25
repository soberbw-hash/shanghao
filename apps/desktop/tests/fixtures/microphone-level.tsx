import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RecordingEncoderState, RecordingState } from "@private-voice/shared";
import { RoomDock } from "../../src/renderer/src/components/room/RoomDock";
import { MuteButton } from "../../src/renderer/src/components/audio/MuteButton";
import "../../src/renderer/src/styles/index.css";
const noop = () => {};
function Fixture() {
  const [muted, setMuted] = useState(false);
  return (
    <main
      className="room-page"
      style={{ padding: "170px 26px 30px", minHeight: 440, background: "#e9f3fd" }}
    >
      <RoomDock
        settings={{
          microphoneSendVolume: 1,
          speakerMasterVolume: 1,
          isNoiseSuppressionEnabled: true,
          isEchoCancellationEnabled: true,
          isVoiceEnhancementEnabled: true,
          isAutoGainControlEnabled: true,
          isPushToTalkEnabled: false,
          pushToTalkShortcut: "Space",
          micEqualizerGains: [0, 0, 0, 0, 0],
          lowCutFrequency: "75",
          isFriendLoudnessBalanceEnabled: true,
        }}
        inputDevices={[]}
        outputDevices={[]}
        isMuted={muted}
        isDeafened={false}
        isNoiseSuppressionSwitching={false}
        microphoneTest={{
          phase: "idle",
          level: 0,
          isClipping: false,
          onToggle: noop,
          onPlaySystemCapture: noop,
          onPlayProcessed: noop,
        }}
        recordingState={RecordingState.Idle}
        recordingEncoderState={RecordingEncoderState.NativeAacAvailable}
        localScreenShareActive={false}
        isScreenShareStarting={false}
        isOverlayOpen={false}
        isLeaving={false}
        onToggleMicrophone={() => setMuted((value) => !value)}
        onToggleDeafen={noop}
        onSwitchInputDevice={noop}
        onMicrophoneVolumePreview={noop}
        onMicrophoneVolumeCommit={noop}
        onNoiseSuppressionChange={noop}
        onEchoCancellationChange={noop}
        onVoiceEnhancementChange={noop}
        onAutoGainChange={noop}
        onPushToTalkEnabledChange={noop}
        onPushToTalkShortcutChange={noop}
        onResetMicrophoneVolume={noop}
        onSwitchOutputDevice={noop}
        onSpeakerVolumePreview={noop}
        onSpeakerVolumeCommit={noop}
        onLoudnessBalanceChange={noop}
        onTestSpeaker={noop}
        onResetSpeakerVolume={noop}
        onToggleRecording={noop}
        onToggleScreenShare={noop}
        onToggleOverlay={noop}
        onLeave={noop}
      />
      <div id="standalone" style={{ marginTop: 30 }}>
        <MuteButton isMuted={muted} onClick={() => setMuted((value) => !value)} />
      </div>
      <div id="samples" aria-hidden="true" style={{ display: "flex", gap: 24, marginTop: 32 }} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
