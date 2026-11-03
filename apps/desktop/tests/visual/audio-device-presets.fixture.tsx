import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AudioDeviceState,
  RoomConnectionState,
  selectAudioDeviceSettings,
  type AppSettings,
  type RoomMember,
} from "@private-voice/shared";
import { AudioDevicePresets } from "../../src/renderer/src/components/audio/AudioDevicePresets";
import { AudioControlPopover } from "../../src/renderer/src/components/audio/AudioControlPopover";
import { AudioPresetShortcutSettings } from "../../src/renderer/src/components/settings/AudioPresetShortcutSettings";
import { useSettingsStore } from "../../src/renderer/src/store/settingsStore";
import { useAudioStore } from "../../src/renderer/src/store/audioStore";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { setAudioSendEnabled } from "../../src/renderer/src/features/audio/audioSendGate";
import { getRemoteAudioMixer } from "../../src/renderer/src/features/audio/RemoteAudioMixer";
import "../../src/renderer/src/styles/index.css";

// Only UI settings persistence and microphone acquisition are fixtures. The send gate and sink route are real.
const initial = useSettingsStore.getState().settings!;
// A temporary in-memory settings profile, never the real user profile.
const audio = {
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  microphoneSendVolume: 1,
  speakerMasterVolume: 1,
  isNoiseSuppressionEnabled: true,
  isEchoCancellationEnabled: true,
  isVoiceEnhancementEnabled: true,
  isAutoGainControlEnabled: true,
  micEqualizerGains: [0, 0, 0, 0, 0] as [number, number, number, number, number],
  lowCutFrequency: "75" as const,
  isFriendLoudnessBalanceEnabled: true,
};
const settings = {
  ...initial,
  ...audio,
  audioDevicePresets: [
    { slot: 0 as const, name: "桌面模式", audio, microphoneMuted: false, speakerMuted: false },
    {
      slot: 1 as const,
      name: "游戏模式",
      audio: { ...audio, microphoneSendVolume: 1.2, speakerMasterVolume: 0.7 },
      microphoneMuted: false,
      speakerMuted: false,
    },
  ],
} as AppSettings;
let writes = 0,
  failSave = false;
useSettingsStore.setState({
  settings,
  saveSettings: async (patch) => {
    writes++;
    await new Promise((resolve) => setTimeout(resolve, 70));
    if (failSave) {
      failSave = false;
      throw Error("synthetic_save_failure");
    }
    if (patch.audioDevicePresetShortcut === "Ctrl+Shift+F10")
      return useSettingsStore.getState().settings!;
    const next = { ...useSettingsStore.getState().settings!, ...patch };
    useSettingsStore.setState({ settings: next });
    return next;
  },
});
useAudioStore.setState({
  inputDevices: [
    {
      id: "fixture-mic",
      label: "USB 麦克风",
      kind: "audioinput",
      state: AudioDeviceState.Ready,
      isDefault: false,
    },
  ],
  outputDevices: [
    {
      id: "fixture-speaker",
      label: "游戏耳机",
      kind: "audiooutput",
      state: AudioDeviceState.Ready,
      isDefault: false,
    },
  ],
  refreshDevices: async () => {},
});
useRoomStore.getState().setRoom({
  roomId: "fixture",
  connectionState: RoomConnectionState.WaitingPeer,
  members: [{ id: "synthetic", isLocal: true }] as RoomMember[],
});
useAudioStore.getState().setMuted(true);
const context = new AudioContext(),
  oscillator = context.createOscillator(),
  output = context.createMediaStreamDestination();
oscillator.connect(output);
oscillator.start();
const tracks: MediaStreamTrack[] = [];
let pending: (() => void) | undefined,
  shouldStall = false;
let processingBusy = false;
const stream = () => {
  const track = output.stream.getAudioTracks()[0]!.clone();
  tracks.push(track);
  return new MediaStream([track]);
};
useRoomStore.getState().setLocalStream(stream());
const result = {
  switches: 0,
  gateWasClosed: true,
  liveTrack: () => useRoomStore.getState().localStream!.getAudioTracks()[0]!,
  settings: () => useSettingsStore.getState().settings,
  connection: (state: RoomConnectionState) => useRoomStore.getState().setConnectionState(state),
  writes: () => writes,
  failSave: () => {
    failSave = true;
  },
  empty: () => useSettingsStore.setState({ settings: { ...settings, audioDevicePresets: [] } }),
  unmute: () => useAudioStore.getState().setMuted(false),
  markMissing: () => {
    const state = useSettingsStore.getState().settings!;
    useSettingsStore.setState({
      settings: {
        ...state,
        audioDevicePresets: state.audioDevicePresets!.map((preset) =>
          preset.slot === 1
            ? { ...preset, audio: { ...preset.audio, preferredInputDeviceId: "missing-test-mic" } }
            : preset,
        ),
      },
    });
  },
  route: () => getRemoteAudioMixer().getDiagnostics().outputRouteStatus,
  blockProcessing: (enabled: boolean) => {
    processingBusy = enabled;
  },
  stall: () => {
    shouldStall = true;
    useSettingsStore.setState({ settings });
  },
  isPending: () => !!pending,
  jump: () => {
    useRoomStore.getState().setRoom({
      roomId: "next-room",
      connectionState: RoomConnectionState.Connected,
      members: [{ id: "next-synthetic", isLocal: true }] as RoomMember[],
    });
    useRoomStore.getState().setLocalStream(stream());
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings!, microphoneSendVolume: 1.45 },
    });
  },
  openNewTrack: () =>
    setAudioSendEnabled(useRoomStore.getState().localStream!.getAudioTracks()[0]!, true),
  release: () => {
    pending?.();
    pending = undefined;
  },
  async close() {
    for (const track of tracks) track.stop();
    oscillator.stop();
    await context.close();
  },
};
const replace = async () => {
  const roomId = useRoomStore.getState().room.roomId;
  result.switches++;
  await new Promise((resolve) => setTimeout(resolve, 80));
  if (shouldStall) {
    shouldStall = false;
    await new Promise<void>((resolve) => {
      pending = resolve;
    });
  }
  if (roomId !== useRoomStore.getState().room.roomId) return false;
  const next = stream();
  setAudioSendEnabled(next.getAudioTracks()[0]!, true);
  result.gateWasClosed &&= !next.getAudioTracks()[0]!.enabled;
  useRoomStore.getState().setLocalStream(next);
  return true;
};
Object.assign(window, { audioPresetFixture: result, selectAudioDeviceSettings });
function Fixture() {
  const [host, setHost] = useState<HTMLDivElement | null>(null),
    [menu, setMenu] = useState(false);
  return (
    <main style={{ padding: 30, background: "#eaf3fc", height: "100vh" }}>
      <button onClick={() => setMenu(true)}>打开设备</button>
      {menu && (
        <div className="audio-control-anchor">
          <AudioControlPopover
            title="麦克风"
            devices={[]}
            volume={1}
            min={0.5}
            max={1.5}
            onDeviceChange={() => {}}
            onVolumePreview={() => {}}
            onVolumeCommit={() => {}}
            onReset={() => {}}
            presetControlHost={setHost}
          />
        </div>
      )}
      <AudioDevicePresets
        buttonHost={host}
        replaceInput={replace}
        isProcessingBusy={() => processingBusy}
      />
      <div id="fixture-shortcut-settings">
        <AudioPresetShortcutSettings />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
