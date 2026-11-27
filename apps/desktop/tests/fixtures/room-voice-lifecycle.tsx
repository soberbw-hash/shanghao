import { createRoot } from "react-dom/client";
import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  MemberPresenceState,
  MemberSpeakingState,
  type AppSettings,
  type DesktopApi,
  type PrivateRoomInfo,
  type SignalingEventPayload,
} from "@private-voice/shared";
import type { SignalEnvelope } from "@private-voice/signaling";
import "../../src/renderer/src/styles/index.css";

const address = "ws://fixture.local/";
const room: PrivateRoomInfo = {
  roomId: `room_${"a".repeat(32)}`,
  channelCode: "000021",
  name: "测试语音房",
  ownerId: "fixture",
  icon: "headphones",
  createdAt: "2026-11-26T00:00:00Z",
  updatedAt: "2026-11-26T00:00:00Z",
  onlineCount: 0,
  capacity: 5,
};
const settings = {
  profileId: "fixture",
  nickname: "测试用户",
  relayServerUrl: address,
  preferredInputDeviceId: undefined,
  isNoiseSuppressionEnabled: false,
  isVoiceEnhancementEnabled: false,
  isSystemNotificationEnabled: false,
  isUiSoundEnabled: false,
  memberVolumes: {},
  quickMessages: {},
} as AppSettings;

let sessionId = "";
let signal: ((event: SignalingEventPayload) => void) | undefined;
let join: Extract<SignalEnvelope, { type: "join_channel" }> | undefined;
let closing: (() => void) | undefined;
let media = 0;
let capturesEnabled = true;
const send = (packet: SignalEnvelope) =>
  signal?.({ type: "message", sessionId, data: JSON.stringify(packet) });

window.desktopApi = {
  app: { writeLog: async () => undefined },
  overlay: { onQuickMessageMute: () => () => undefined },
  signaling: {
    connect: async (_url: string, id: string) => {
      sessionId = id;
      signal?.({ type: "open", sessionId });
    },
    onEvent: (listener: typeof signal) => {
      signal = listener;
      return () => {
        if (signal === listener) signal = undefined;
      };
    },
    send: async (raw: string) => {
      const message = JSON.parse(raw) as SignalEnvelope;
      if (message.type === "join_channel") join = message;
    },
    close: () =>
      new Promise<void>((resolve) => {
        closing = resolve;
      }),
  },
  rooms: {
    history: async () => ({ recent: [room], favorites: [] }),
    mine: async () => [],
    get: async () => room,
    find: async () => room,
    rememberJoined: async () => undefined,
  },
} as unknown as DesktopApi;

const captureContext = new AudioContext({ sampleRate: 48_000 });
const rawTracks: MediaStreamTrack[] = [];
const makeStream = () => {
  const destination = captureContext.createMediaStreamDestination();
  return destination.stream;
};
Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
  configurable: true,
  value: async () => {
    media++;
    if (!capturesEnabled) throw new DOMException("fixture mic denied", "NotAllowedError");
    const stream = makeStream();
    rawTracks.push(...stream.getAudioTracks());
    return stream;
  },
});

const { useAppStore } = await import("../../src/renderer/src/store/appStore");
const { useSettingsStore } = await import("../../src/renderer/src/store/settingsStore");
const { useRoomStore } = await import("../../src/renderer/src/store/roomStore");
const { useAccountStore } = await import("../../src/renderer/src/store/accountStore");
const { useLocalAudioTransport } =
  await import("../../src/renderer/src/hooks/useLocalAudioTransport");
const { useRoomState } = await import("../../src/renderer/src/hooks/useRoomState");
const { RemoteAudioRenderer } =
  await import("../../src/renderer/src/features/audio/RemoteAudioRenderer");
const { getRemoteAudioMixer } =
  await import("../../src/renderer/src/features/audio/RemoteAudioMixer");
const { PrivateRoomBrowser } =
  await import("../../src/renderer/src/components/room/PrivateRoomBrowser");
useSettingsStore.setState({ settings, runtimeInfo: { version: "3.4.23" } as never });
useAccountStore.setState({
  snapshot: {
    status: "signed_in",
    configured: true,
    guestAllowed: false,
    profile: { userId: "fixture", username: "fixture", displayName: "测试用户" },
  },
});
const captureDiagnostics = () => getRemoteAudioMixer().getDiagnostics();
const fixture = {
  ack: () =>
    send({
      type: "join_ack",
      roomId: room.roomId,
      peerId: join!.peerId,
      serverTime: Date.now(),
      revision: 1,
      memberCount: 1,
      sessionToken: "fixture-token",
      appVersion: "3.4.23",
      buildNumber: APP_BUILD_NUMBER,
      protocolVersion: APP_PROTOCOL_VERSION,
    }),
  snapshot: () =>
    send({
      type: "room_snapshot",
      roomId: room.roomId,
      roomName: room.name,
      privateRoom: room,
      members: [
        {
          id: join!.peerId,
          nickname: "测试用户",
          avatarId: "fox",
          isLocal: true,
          isMuted: false,
          isDeafened: false,
          presenceState: MemberPresenceState.Online,
          speakingState: MemberSpeakingState.Silent,
          volume: 1,
        },
      ],
      revision: 1,
      serverTime: Date.now(),
      appVersion: "3.4.23",
      buildNumber: APP_BUILD_NUMBER,
      protocolVersion: APP_PROTOCOL_VERSION,
    }),
  remote: () => {
    useRoomStore.getState().setRemoteStream("synthetic-peer", makeStream());
    getRemoteAudioMixer().playRelaySamples(
      "synthetic-relay",
      new Float32Array(4800),
      48_000,
      100,
      1,
    );
  },
  finishClose: () => {
    closing?.();
    closing = undefined;
    join = undefined;
  },
  denyMicrophone: () => {
    capturesEnabled = false;
  },
  state: () => ({
    page: useAppStore.getState().currentPage,
    action: useAppStore.getState().roomAction,
    connection: useRoomStore.getState().room.connectionState,
    wireJoined: Boolean(join),
    micRequests: media,
    inputEnabled: Boolean(useRoomStore.getState().localStream?.getAudioTracks()[0]?.enabled),
    rawLive: rawTracks.some((track) => track.readyState === "live"),
    closing: Boolean(closing),
    webrtcCount: captureDiagnostics().webrtcChannelCount,
    relayCount: captureDiagnostics().relayChannelCount,
  }),
};
Object.assign(window, { roomVoiceFixture: fixture });

function Fixture() {
  useLocalAudioTransport();
  const { joinChannel, leaveRoom } = useRoomState();
  const page = useAppStore((state) => state.currentPage);
  const action = useAppStore((state) => state.roomAction);
  return (
    <main style={{ width: 620, margin: "32px auto" }}>
      <RemoteAudioRenderer />
      {page === "room" ? (
        <section aria-label="已进入房间">
          <button onClick={() => void leaveRoom()}>退出房间</button>
        </section>
      ) : (
        <PrivateRoomBrowser
          busy={action !== "idle"}
          onJoin={(target) => joinChannel(address, target.roomId)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
