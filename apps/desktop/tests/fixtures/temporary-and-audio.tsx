import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type {
  ApplicationAudioFrame,
  ApplicationAudioState,
  DesktopApi,
  TemporaryRoomDescriptor,
  TemporaryRoomClientState,
} from "@private-voice/shared";
import { TemporaryRoomEntry } from "../../src/renderer/src/components/room/TemporaryRoomEntry";
import { TemporaryRoomControls } from "../../src/renderer/src/components/room/TemporaryRoomControls";
import { useTemporaryRoomState } from "../../src/renderer/src/hooks/useTemporaryRoomState";
import { ApplicationAudioControl } from "../../src/renderer/src/components/audio/ApplicationAudioControl";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { useAccountStore } from "../../src/renderer/src/store/accountStore";
import "../../src/renderer/src/styles/index.css";

const state = {
  joined: "",
  savedName: "",
  savedAvatar: "",
  preparedAvatars: 0,
  started: 0,
  stopped: 0,
  acknowledged: 0,
  attached: false,
  maximumRms: 0,
  gain: 0.72,
};
const avatar =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lR8AAAAASUVORK5CYII=";
if (location.search.includes("signed=1"))
  useAccountStore.setState({
    snapshot: {
      status: "signed_in",
      configured: true,
      guestAllowed: false,
      profile: {
        userId: "synthetic-account",
        username: "synthetic",
        displayName: "账号朋友",
        avatarUrl: location.search.includes("preset=1") ? undefined : avatar,
        accountAvatarPresetId: "sky-cat",
      },
    } as never,
  });
Object.assign(window, { fixtureState: state });
const temporaryStates = new Set<(value: TemporaryRoomClientState) => void>();
Object.assign(window, {
  emitTemporaryState: (value: TemporaryRoomClientState) => {
    for (const listener of temporaryStates) listener(value);
  },
});
const frames = new Set<(frame: ApplicationAudioFrame) => void>();
const states = new Set<(value: ApplicationAudioState) => void>();
let interval: ReturnType<typeof setInterval> | undefined;
let sequence = 0;
const session = {
  sessionId: "fixture-audio",
  sampleRate: 48000 as const,
  channels: 2 as const,
  format: "s16le" as const,
  gain: 0.72,
};
const descriptor = {
  contextId: "fixture-context",
  signalingUrl: "wss://example.test/?mode=temporary#temporary=fixture-context",
  roomId: `temp_${"a".repeat(32)}`,
  peerId: "fixture-member",
  nickname: "临时朋友",
  roomName: "临时联机",
  connectionWarning: "temporary_internet_bridge_unavailable",
  room: { code: "00123456", members: [] },
} as TemporaryRoomDescriptor;
window.desktopApi = {
  temporaryRooms: {
    getProfile: async () => ({ nickname: "临时朋友", avatarDataUrl: avatar }),
    prepareAvatar: async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      state.preparedAvatars++;
      return avatar;
    },
    saveProfile: async (profile) => {
      state.savedName = profile.nickname;
      state.savedAvatar = profile.avatarDataUrl ?? "";
      return profile;
    },
    create: async () => descriptor,
    join: async () => descriptor,
    release: async () => undefined,
    onChanged: (listener) => {
      temporaryStates.add(listener);
      return () => temporaryStates.delete(listener);
    },
  },
  applicationAudio: {
    listSources: async () => ({
      supported: true,
      sources: [{ id: "synthetic", name: "合成测试音乐", processName: "QQMusic.exe" }],
    }),
    start: async () => {
      state.started++;
      interval = setInterval(() => {
        const data = new Uint8Array(960 * 4),
          view = new DataView(data.buffer);
        for (let frame = 0; frame < 960; frame++) {
          const sample = Math.round(
            Math.sin(((sequence * 960 + frame) * Math.PI * 2 * 440) / 48000) * 8000,
          );
          view.setInt16(frame * 4, sample, true);
          view.setInt16(frame * 4 + 2, sample, true);
        }
        const value: ApplicationAudioFrame = {
          ...session,
          sequence: sequence++,
          frames: 960,
          data,
          capturedAt: Date.now(),
        };
        for (const listener of frames) listener(value);
      }, 20);
      return session;
    },
    stop: async () => {
      state.stopped++;
      clearInterval(interval);
      for (const listener of states) listener({ ...session, phase: "stopped" });
    },
    setGain: async (_id, gain) => {
      state.gain = gain;
      return { ...session, gain, phase: "sharing" as const };
    },
    acknowledge: () => {
      state.acknowledged++;
    },
    onFrame: (listener) => {
      frames.add(listener);
      return () => frames.delete(listener);
    },
    onState: (listener) => {
      states.add(listener);
      return () => states.delete(listener);
    },
  },
} as unknown as DesktopApi;
useRoomStore.getState().setRoom({ roomId: descriptor.roomId });
let probe: AudioContext | undefined;
let measure: ReturnType<typeof setInterval> | undefined;
const onTrack = async (track?: MediaStreamTrack) => {
  clearInterval(measure);
  await probe?.close();
  probe = undefined;
  state.attached = Boolean(track);
  if (!track) return;
  probe = new AudioContext({ sampleRate: 48000 });
  const analyser = probe.createAnalyser(),
    mute = probe.createGain();
  mute.gain.value = 0;
  probe
    .createMediaStreamSource(new MediaStream([track]))
    .connect(analyser)
    .connect(mute)
    .connect(probe.destination);
  await probe.resume();
  const samples = new Float32Array(analyser.fftSize);
  measure = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    state.maximumRms = Math.max(
      state.maximumRms,
      Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length),
    );
  }, 20);
};
function Fixture() {
  const [audioEvidence, setAudioEvidence] = useState("");
  useEffect(() => {
    const timer = setInterval(
      () =>
        setAudioEvidence(
          `RMS ${state.maximumRms.toFixed(3)} · attached=${state.attached} · stopped=${state.stopped}`,
        ),
      100,
    );
    return () => clearInterval(timer);
  }, []);
  useTemporaryRoomState(async () => undefined);
  return (
    <main
      style={{
        margin: "40px auto",
        padding: 30,
        maxWidth: 850,
        minHeight: 730,
        background: "#f8fcff",
        borderRadius: 24,
      }}
    >
      <h1>临时联机</h1>
      <output aria-label="隔离音频测试证据">{audioEvidence}</output>
      <TemporaryRoomEntry
        onJoin={async (room) => {
          state.joined = room.roomId;
          useRoomStore.getState().setRoom({ temporaryRoom: room });
        }}
      />
      <TemporaryRoomControls />
      <div style={{ marginTop: 420, display: "flex", justifyContent: "flex-end" }}>
        <ApplicationAudioControl onTrack={onTrack} />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
