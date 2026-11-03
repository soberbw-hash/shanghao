import { createRoot } from "react-dom/client";
import { useEffect, useState, type ComponentProps } from "react";
import { RecordingEncoderState, RecordingState } from "@private-voice/shared";
import { RoomDock } from "../../src/renderer/src/components/room/RoomDock";
import { MemberAvailabilityControls } from "../../src/renderer/src/components/chat/MemberAvailabilityControls";
import { ScreenSharePanel } from "../../src/renderer/src/components/room/ScreenSharePanel";
import { ScreenSharePanelContainer } from "../../src/renderer/src/components/room/ScreenSharePanelContainer";
import "../../src/renderer/src/styles/index.css";

const noop = () => {};
Object.defineProperty(window, "desktopApi", {
  value: {
    voiceReplay: { onSaveShortcut: () => noop, shortcut: async () => true },
  },
  configurable: true,
});
const dock = {
  inputDevices: [],
  outputDevices: [],
  isMuted: false,
  isDeafened: false,
  isNoiseSuppressionSwitching: false,
  microphoneTest: {},
  recordingState: RecordingState.Idle,
  recordingEncoderState: RecordingEncoderState.NativeAacAvailable,
  localScreenShareActive: false,
  isScreenShareStarting: false,
  isOverlayOpen: false,
  isLeaving: false,
  onToggleMicrophone: noop,
  onToggleDeafen: noop,
  onSwitchInputDevice: noop,
  onMicrophoneVolumePreview: noop,
  onMicrophoneVolumeCommit: noop,
  onNoiseSuppressionChange: noop,
  onEchoCancellationChange: noop,
  onVoiceEnhancementChange: noop,
  onAutoGainChange: noop,
  onPushToTalkEnabledChange: noop,
  onPushToTalkShortcutChange: noop,
  onResetMicrophoneVolume: noop,
  onSwitchOutputDevice: noop,
  onSpeakerVolumePreview: noop,
  onSpeakerVolumeCommit: noop,
  onLoudnessBalanceChange: noop,
  onTestSpeaker: noop,
  onResetSpeakerVolume: noop,
  onToggleRecording: noop,
  onToggleScreenShare: noop,
  onToggleOverlay: noop,
  onLeave: noop,
} as ComponentProps<typeof RoomDock>;
const canvas = document.createElement("canvas");
canvas.width = 1280;
canvas.height = 720;
const context = canvas.getContext("2d")!;
context.fillStyle = "#27557d";
context.fillRect(0, 0, 1280, 720);
context.fillStyle = "#ffffff";
context.font = "48px sans-serif";
context.fillText("Synthetic shared screen", 80, 360);
const stream = canvas.captureStream(1);
let syncCount = 0;
function DetachedRebindFixture() {
  const [current, setCurrent] = useState(stream);
  useEffect(() => {
    const replace = () => setCurrent(new MediaStream(stream.getVideoTracks()));
    document.addEventListener("fixture-replace-stream", replace);
    return () => document.removeEventListener("fixture-replace-stream", replace);
  }, []);
  return (
    <aside hidden>
      <ScreenSharePanelContainer
        localStream={current}
        localViewerNames={[]}
        detachedItemId="local"
        onStopLocalShare={noop}
        onOpenDetached={async () => {}}
        syncDetachedItem={async (item) => {
          document.documentElement.dataset.detachedSyncCount = String(++syncCount);
          document.documentElement.dataset.detachedStreamId = item?.stream?.id;
        }}
      />
    </aside>
  );
}
window.setInterval(() => {
  context.fillStyle = "#27557d";
  context.fillRect(0, 0, 1280, 720);
  context.fillStyle = "#ffffff";
  context.fillText("Synthetic shared screen", 80, 360);
  (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame();
}, 250);
createRoot(document.getElementById("root")!).render(
  <main className="room-page" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <section style={{ position: "relative", flex: 1 }}>
      <ScreenSharePanel
        items={[{ id: "fixture", title: "测试分享", isLocal: false, transport: "webrtc", stream }]}
        localViewerNames={[]}
        onStopLocalShare={noop}
        onOpenDetached={async () => {
          throw Error("detached unavailable");
        }}
      />
    </section>
    <RoomDock
      {...dock}
      presenceControls={<MemberAvailabilityControls canSend send={async () => {}} />}
    />
    <DetachedRebindFixture />
  </main>,
);
