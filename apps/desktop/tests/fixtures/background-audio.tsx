import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MemberSpeakingState,
  RoomConnectionState,
  type AppSettings,
  type BackgroundAudioState,
} from "@private-voice/shared";
import { AudioControlPopover } from "../../src/renderer/src/components/audio/AudioControlPopover";
import { BackgroundAudioBalanceShortcut } from "../../src/renderer/src/components/audio/BackgroundAudioBalance";
import { useBackgroundAudioBalance } from "../../src/renderer/src/features/audio/backgroundAudioBalance";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { useSettingsStore } from "../../src/renderer/src/store/settingsStore";
import { useAudioStore } from "../../src/renderer/src/store/audioStore";
import "../../src/renderer/src/styles/index.css";

const state: BackgroundAudioState = {
  enabled: false,
  available: true,
  shortcut: "",
  phase: "off",
  revision: 1,
};
const listeners = new Set<(value: BackgroundAudioState) => void>();
let calls = 0,
  pulses = 0;
let pulseDelay = 0,
  speechPulses = 0;
if (!window.desktopApi?.backgroundAudio)
  Object.defineProperty(window, "desktopApi", {
    configurable: true,
    value: {
      backgroundAudio: {
        pulse: async (activity: { inRoom: boolean; speaking: boolean }) => {
          document.documentElement.dataset.pulses = String(++pulses);
          document.documentElement.dataset.speaking = String(activity.speaking);
          if (activity.speaking)
            document.documentElement.dataset.speechPulses = String(++speechPulses);
          if (pulseDelay) await new Promise((resolve) => setTimeout(resolve, pulseDelay));
          const phase =
            state.enabled && activity.inRoom ? (activity.speaking ? "balancing" : "ready") : "off";
          if (phase !== state.phase) {
            state.phase = phase;
            state.revision++;
          }
          return structuredClone(state);
        },
        configure: async (patch: { enabled?: boolean; shortcut?: string }) => {
          document.documentElement.dataset.configurations = String(++calls);
          await new Promise((resolve) => setTimeout(resolve, 80));
          Object.assign(state, patch);
          state.revision++;
          return structuredClone(state);
        },
        onChanged: (listener: (value: BackgroundAudioState) => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
  });
useSettingsStore.setState({
  settings: {
    isBackgroundAudioBalanceEnabled: false,
    backgroundAudioBalanceShortcut: "",
  } as AppSettings,
});
useRoomStore.setState((current) => ({
  room: {
    ...current.room,
    connectionState: RoomConnectionState.Connected,
    members: [
      {
        ...current.room.members[0],
        id: "synthetic-local",
        isLocal: true,
        isEmptySlot: false,
        speakingState: MemberSpeakingState.Speaking,
      },
    ],
  },
}));
document.addEventListener("fixture-stale-state", () => {
  for (const listener of listeners) listener({ ...state, enabled: false, revision: 1 });
});
document.addEventListener("fixture-mute", () => {
  useAudioStore.getState().setMuted(true);
});
document.addEventListener("fixture-unmute", () => {
  useAudioStore.getState().setMuted(false);
});

const speaking = (value: boolean) =>
  useRoomStore.setState((current) => ({
    room: {
      ...current.room,
      members: current.room.members.map((member) => ({
        ...member,
        speakingState: value ? MemberSpeakingState.Speaking : MemberSpeakingState.Silent,
      })),
    },
  }));
Object.assign(window, {
  backgroundAudioFixture: {
    speaking,
    delay: (ms: number) => {
      pulseDelay = ms;
    },
  },
});
document.addEventListener("fixture-unavailable", () => {
  state.available = false;
  state.revision++;
  for (const listener of listeners) listener(structuredClone(state));
});
const noop = () => {};
function Fixture() {
  useBackgroundAudioBalance();
  const [settings, setSettings] = useState(false);
  return (
    <main className="room-page" style={{ height: "100vh", padding: 24 }}>
      <button id="fixture-switch-page" onClick={() => setSettings((value) => !value)}>
        切换设置页面
      </button>
      {settings ? (
        <BackgroundAudioBalanceShortcut />
      ) : (
        <div style={{ position: "absolute", left: 30, bottom: 30 }}>
          <AudioControlPopover
            title="扬声器"
            devices={[]}
            volume={1}
            min={0}
            max={2}
            onDeviceChange={noop}
            onVolumePreview={noop}
            onVolumeCommit={noop}
            onReset={noop}
          />
        </div>
      )}
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
import.meta.hot?.dispose(() => root.unmount());
