import type { NetworkAdaptationTier, PeerAudioStats } from "@private-voice/webrtc";
import type { AudioFallbackController } from "../audio/AudioFallbackController";
import type { RemoteAudioMixerDiagnostics } from "../audio/RemoteAudioMixer";

export interface RoomDiagnosticsInput {
  currentPeerId: string;
  reconnectAttempts: number;
  lastSocketCloseCode?: number;
  lastSocketCloseReason?: string;
  lastSocketClosedAt?: string;
  audioRelayActive: boolean;
  remotePeerCount: number;
  roomSnapshotRevision: number;
  chatSendFailures: number;
  joinStage: string;
  wsOpened: boolean;
  joinChannelSent: boolean;
  joinAckReceived: boolean;
  roomSnapshotReceived: boolean;
  lastServerError?: string;
  screenShareRelayActive: boolean;
  screenShareRelayTargetCount: number;
  audioRelayDiagnostics?: ReturnType<AudioFallbackController["getDiagnostics"]>;
  webrtcReadyPeerCount: number;
  webrtcConnectedPeerCount: number;
  webrtcAudioPeerCount: number;
  webrtcFlowingPeerCount: number;
  peerRecoveryAttempts: Record<string, number>;
  peerConnectionStats: Record<string, PeerAudioStats>;
  peerAdaptationTiers: Record<string, NetworkAdaptationTier>;
  peerAudioPaths: Record<string, "webrtc" | "relay">;
  remoteAudioMixer: RemoteAudioMixerDiagnostics;
  turnConfigured: boolean;
}

export const buildRoomDiagnostics = (input: RoomDiagnosticsInput) => ({
  currentPeerId: input.currentPeerId,
  reconnectAttempts: input.reconnectAttempts,
  lastSocketCloseCode: input.lastSocketCloseCode,
  lastSocketCloseReason: input.lastSocketCloseReason,
  lastSocketClosedAt: input.lastSocketClosedAt,
  audioRelayState: input.audioRelayActive ? ("active" as const) : ("inactive" as const),
  remotePeerCount: input.remotePeerCount,
  roomSnapshotRevision: input.roomSnapshotRevision,
  chatSendFailures: input.chatSendFailures,
  joinStage: input.joinStage,
  wsOpened: input.wsOpened,
  joinChannelSent: input.joinChannelSent,
  joinAckReceived: input.joinAckReceived,
  roomSnapshotReceived: input.roomSnapshotReceived,
  lastServerError: input.lastServerError,
  screenShareRelayState: input.screenShareRelayActive ? ("active" as const) : ("inactive" as const),
  screenShareRelayTargetCount: input.screenShareRelayTargetCount,
  audioRelayDiagnostics: input.audioRelayDiagnostics,
  webrtcReadyPeerCount: input.webrtcReadyPeerCount,
  webrtcConnectedPeerCount: input.webrtcConnectedPeerCount,
  webrtcAudioPeerCount: input.webrtcAudioPeerCount,
  webrtcFlowingPeerCount: input.webrtcFlowingPeerCount,
  peerRecoveryAttempts: input.peerRecoveryAttempts,
  peerConnectionStats: input.peerConnectionStats,
  peerAdaptationTiers: input.peerAdaptationTiers,
  peerAudioPaths: input.peerAudioPaths,
  remoteAudioMixer: input.remoteAudioMixer,
  turnConfigured: input.turnConfigured,
});

export interface RoomDiagnosticsSources {
  currentPeerId: string;
  reconnectAttempts: number;
  socket: Pick<
    RoomDiagnosticsInput,
    "lastSocketCloseCode" | "lastSocketCloseReason" | "lastSocketClosedAt"
  >;
  audioRelayActive: boolean;
  remotePeerIds: Set<string>;
  roomSnapshotRevision: number;
  chatSendFailures: number;
  join: Pick<
    RoomDiagnosticsInput,
    | "joinStage"
    | "wsOpened"
    | "joinChannelSent"
    | "joinAckReceived"
    | "roomSnapshotReceived"
    | "lastServerError"
  >;
  screenShareRelayActive: boolean;
  screenShareRelayTargetCount: number;
  audioRelayDiagnostics?: RoomDiagnosticsInput["audioRelayDiagnostics"];
  webrtcReadyPeerIds: Set<string>;
  webrtcConnectedPeerIds: Set<string>;
  webrtcAudioPeerIds: Set<string>;
  webrtcFlowingPeerIds: Set<string>;
  peerRecoveryAttempts: ReadonlyMap<string, number>;
  peerConnectionStats: RoomDiagnosticsInput["peerConnectionStats"];
  peerAdaptationTiers: RoomDiagnosticsInput["peerAdaptationTiers"];
  remoteAudioMixer: RemoteAudioMixerDiagnostics;
  turnConfigured: boolean;
}

export const buildRoomDiagnosticsFromSources = (source: RoomDiagnosticsSources) =>
  buildRoomDiagnostics({
    currentPeerId: source.currentPeerId,
    reconnectAttempts: source.reconnectAttempts,
    ...source.socket,
    audioRelayActive: source.audioRelayActive,
    remotePeerCount: source.remotePeerIds.size,
    roomSnapshotRevision: source.roomSnapshotRevision,
    chatSendFailures: source.chatSendFailures,
    ...source.join,
    screenShareRelayActive: source.screenShareRelayActive,
    screenShareRelayTargetCount: source.screenShareRelayTargetCount,
    audioRelayDiagnostics: source.audioRelayDiagnostics,
    webrtcReadyPeerCount: source.webrtcReadyPeerIds.size,
    webrtcConnectedPeerCount: source.webrtcConnectedPeerIds.size,
    webrtcAudioPeerCount: source.webrtcAudioPeerIds.size,
    webrtcFlowingPeerCount: source.webrtcFlowingPeerIds.size,
    peerRecoveryAttempts: Object.fromEntries(source.peerRecoveryAttempts),
    peerConnectionStats: source.peerConnectionStats,
    peerAdaptationTiers: source.peerAdaptationTiers,
    peerAudioPaths: Object.fromEntries(
      [...source.remotePeerIds].map((peerId) => [
        peerId,
        source.webrtcReadyPeerIds.has(peerId) ? "webrtc" : "relay",
      ]),
    ),
    remoteAudioMixer: source.remoteAudioMixer,
    turnConfigured: source.turnConfigured,
  });
