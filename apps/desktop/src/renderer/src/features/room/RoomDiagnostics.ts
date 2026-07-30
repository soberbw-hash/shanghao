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
