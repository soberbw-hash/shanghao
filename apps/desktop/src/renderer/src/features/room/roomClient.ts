import {
  MemberSpeakingState,
  RoomConnectionState,
  type BuiltInAvatarId,
  type ChatImageAttachment,
  type ChatMessage,
  type ChatRecallEvent,
  type DailyRoomReport,
  type MemberActivity,
  type MusicActivity,
  type WorkActivity,
  type RoomMember,
  type RoomQuickMessage,
  type RoomCollectionItem,
  type RealtimeFaultCommand,
  type SceneReaction,
  type SceneZoneId,
  type SignalingEventPayload,
} from "@private-voice/shared";
import type {
  AudioChunkMessage,
  AudioPathStateMessage,
  ChatAckMessage,
  ChannelCountsMessage,
  ErrorMessage,
  IceCandidateMessage,
  JoinAckMessage,
  PongMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  PeerRestartRequestMessage,
  RoomSnapshotMessage,
  ChannelSnapshotMessage,
  ScreenFrameMessage,
  ScreenPathStateMessage,
  ScreenShareStateMessage,
  SignalEnvelope,
} from "@private-voice/signaling";
import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_SCREEN_SHARE_PROFILE,
  MeshPeerConnection,
  type InboundAudioFlowEvaluation,
  type PeerAudioStats,
  type ScreenShareEncodingProfile,
} from "@private-voice/webrtc";

import { writeRendererLog } from "../../utils/logger";
import { AudioFallbackController } from "../audio/AudioFallbackController";
import { clampMemberVolume } from "../audio/memberVolume";
import { getRemoteAudioMixer } from "../audio/RemoteAudioMixer";
import { hasPlayableAudioTrack } from "../audio/remoteAudioTrack";
import { logPeerNetworkAdaptation, PeerStatsMonitor } from "./PeerStatsMonitor";
import { PeerOperationQueue } from "./PeerOperationQueue";
import { PeerRecoveryCoordinator } from "./PeerRecoveryCoordinator";
import { SignalingBridge } from "./SignalingBridge";
import { buildRoomDiagnosticsFromSources } from "./RoomDiagnostics";
import { isPeerAudioPathReady, shouldSendAudioRelay } from "./peerAudioPath";
import { PresenceCoordinator } from "./PresenceCoordinator";
import { RoomMemberEventCoordinator } from "./RoomMemberEventCoordinator";
import {
  createSignalingReconnectCoordinator,
  SignalingReconnectCoordinator,
} from "./SignalingReconnectCoordinator";
import { decideSignalingError } from "./signalingErrorPolicy";
import { collectActivePeerIds, normalizeRoomMembers } from "./roomMemberSnapshot";
import { collectLongSessionAudioResources } from "./longSessionAudioResources";
import { isSignalingSessionSupersededError } from "./signalingSessionOwnership";
import { ReliableChatTransport } from "../chat/ReliableChatTransport";
import { RoomSocialTransport } from "../chat/RoomSocialTransport";
import { ScreenAudioMixer } from "../screen-share/ScreenAudioMixer";
import { RoomScreenShareCoordinator } from "../screen-share/RoomScreenShareCoordinator";
import {
  serverBuildSupportsDailyRoomReports,
  serverBuildSupportsReliableChat,
} from "../chat/serverCapabilities";

interface RoomClientOptions {
  signalingUrl: string;
  roomId: string;
  peerId: string;
  profileId: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  localStream: MediaStream;
  appVersion: string;
  protocolVersion: string;
  buildNumber: string;
  onMembers: (members: RoomMember[]) => void;
  onRoomName: (roomName: string) => void;
  onConnectionState: (state: RoomConnectionState) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | undefined) => void;
  onChatMessage: (message: ChatMessage) => void;
  onChatRecall: (event: ChatRecallEvent) => void;
  onChatHistory: (messages: ChatMessage[]) => void;
  onChannelCounts: (counts: ChannelCountsMessage["counts"]) => void;
  onDailyRoomReports: (roomId: "main" | "side", reports: DailyRoomReport[]) => void;
  onRoomCollection: (items: RoomCollectionItem[], replace: boolean) => void;
  onKnock: (message: ChatMessage) => void;
  onRemoteScreenFrame: (peerId: string, frame?: RemoteScreenFrame) => void;
  onRemoteScreenShareState: (peerId: string, isSharing: boolean) => void;
  onLocalScreenShareViewers?: (peerIds: string[]) => void;
  onSceneReaction: (reaction: SceneReaction) => void;
  onQuickMessage: (message: RoomQuickMessage) => void;
  onDiagnosticEvent?: (payload: SignalingEventPayload) => void;
  onReconnectAttempt?: (attempt: number) => void;
  onReconnectExhausted?: (error: Error) => void;
  onUpdateRequired?: (requiredVersion: string, currentVersion: string) => void;
  onAvatarConflict?: (availableAvatarIds: BuiltInAvatarId[]) => void;
  onSnapshotRevision?: (revision: number) => void;
  onRtt?: (rttMs: number) => void;
  onPeerLatency?: (peerId: string, latencyMs?: number) => void;
  onPeerStats?: (stats: Record<string, PeerAudioStats>) => void;
}
interface PendingConnection {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
}

export interface RemoteScreenFrame {
  data: string;
  width: number;
  height: number;
  sequence: number;
  receivedAt: string;
}

const INITIAL_CONNECT_TIMEOUT_MS = 10_000;
const SNAPSHOT_RETRY_TIMEOUT_MS = 5_000;
const AUDIO_PATH_SYNC_INTERVAL_MS = 3_000;
export { serverBuildSupportsDailyRoomReports, serverBuildSupportsReliableChat };

export class RoomClient {
  private readonly signalingBridge = new SignalingBridge();
  private readonly peers = new Map<string, MeshPeerConnection>();
  private readonly peerVolumes = new Map<string, number>();
  private heartbeatTimer?: number;
  private audioPathSyncTimer?: number;
  private snapshotRetryTimer?: number;
  private shouldReconnect = true;
  private localStream: MediaStream;
  private nickname: string;
  private avatarDataUrl?: string;
  private avatarId?: BuiltInAvatarId;
  private lastPublishedMuteState?: boolean;
  private lastPublishedSpeakingState?: boolean;
  private readonly presenceCoordinator: PresenceCoordinator;
  private lastPublishedNickname: string;
  private lastPublishedAvatarDataUrl?: string;
  private lastPublishedAvatarId?: BuiltInAvatarId;
  private pendingConnection?: PendingConnection;
  private hasJoinedOnce = false;
  private serverBuildNumber?: string;
  private audioFallback?: AudioFallbackController;
  private readonly remotePeerIds = new Set<string>();
  private readonly webrtcConnectedPeerIds = new Set<string>();
  private readonly webrtcAudioPeerIds = new Set<string>();
  private readonly webrtcFlowingPeerIds = new Set<string>();
  private readonly webrtcReadyPeerIds = new Set<string>();
  private readonly webrtcStalledPeerIds = new Set<string>();
  private readonly webrtcScreenPeerIds = new Set<string>();
  private readonly relayRequestedByPeerIds = new Set<string>();
  private readonly advertisedRelayNeeds = new Map<string, boolean>();
  private readonly peerRecovery: PeerRecoveryCoordinator;
  private readonly peerOperationQueue = new PeerOperationQueue();
  private readonly pendingIceCandidates = new Map<string, IceCandidateMessage["candidate"][]>();
  private readonly peerStatsMonitor: PeerStatsMonitor;
  private connectionGeneration?: number;
  private readonly reconnectCoordinator: SignalingReconnectCoordinator;
  private lastSnapshotRevision = 0;
  private isSignalingConnected = false;
  private isDisconnecting = false;
  private lastSocketCloseCode?: number;
  private lastSocketCloseReason?: string;
  private lastSocketClosedAt?: string;
  private readonly chatTransport: ReliableChatTransport;
  private readonly socialTransport: RoomSocialTransport;
  private readonly screenAudioMixer = new ScreenAudioMixer();
  private readonly screenShareCoordinator: RoomScreenShareCoordinator;
  private readonly memberEvents: RoomMemberEventCoordinator;
  private joinStage = "idle";
  private wsOpened = false;
  private joinChannelSent = false;
  private joinAckReceived = false;
  private roomSnapshotReceived = false;
  private lastServerError?: string;
  private primaryInputTrack?: MediaStreamTrack;
  private iceServers?: RTCIceServer[];
  private hasTurnServer = false;
  private reconnectSessionToken?: string;
  private hasLostSignalingOwnership = false;

  constructor(private readonly options: RoomClientOptions) {
    this.localStream = options.localStream;
    this.primaryInputTrack = options.localStream.getAudioTracks()[0];
    this.nickname = options.nickname;
    this.avatarDataUrl = options.avatarDataUrl;
    this.avatarId = options.avatarId;
    this.lastPublishedNickname = options.nickname;
    this.lastPublishedAvatarDataUrl = options.avatarDataUrl;
    this.lastPublishedAvatarId = options.avatarId;
    this.presenceCoordinator = new PresenceCoordinator({
      roomId: options.roomId,
      peerId: options.peerId,
      canPublish: () => this.isSignalingConnected && this.joinAckReceived,
      send: (payload) => this.safeSend(payload),
    });
    this.memberEvents = new RoomMemberEventCoordinator({
      localPeerId: options.peerId,
      onMembers: options.onMembers,
      onCollection: options.onRoomCollection,
      onKnock: options.onKnock,
      onReaction: options.onSceneReaction,
      onQuickMessage: options.onQuickMessage,
    });
    this.chatTransport = new ReliableChatTransport({
      roomId: options.roomId,
      peerId: options.peerId,
      canSend: () => this.canSendChat(),
      getServerBuildNumber: () => this.serverBuildNumber,
      send: (payload) => this.send(payload),
      onMessage: options.onChatMessage,
      onHistory: options.onChatHistory,
      onRecall: options.onChatRecall,
    });
    this.socialTransport = new RoomSocialTransport({
      roomId: options.roomId,
      peerId: options.peerId,
      getNickname: () => this.nickname,
      canSend: () => this.canSendChat(),
      send: (payload) => this.send(payload),
    });
    this.screenShareCoordinator = new RoomScreenShareCoordinator({
      roomId: options.roomId,
      peerId: options.peerId,
      getPeers: () => this.peers,
      getRemotePeerIds: () => this.remotePeerIds,
      getWebRtcScreenPeerIds: () => this.webrtcScreenPeerIds,
      getPrimaryInputTrack: () => this.primaryInputTrack,
      applyScreenAudioMix: (microphoneTrack, systemAudioTrack) =>
        this.applyScreenAudioMix(microphoneTrack, systemAudioTrack),
      restorePrimaryInputTrack: () => this.restorePrimaryInputTrack(),
      safeSend: (payload) => this.safeSend(payload),
      onRemoteFrame: options.onRemoteScreenFrame,
      onRemoteState: options.onRemoteScreenShareState,
      onScreenTrackLost: (peerId) => this.peerRecovery.schedule(peerId, "screen_track_lost"),
      onLocalViewerIdsChange: options.onLocalScreenShareViewers ?? (() => undefined),
    });
    this.peerStatsMonitor = new PeerStatsMonitor({
      getPeers: () => this.peers,
      getPeerState: (peerId) => {
        const member = this.memberEvents.currentMembers.find(
          (candidate) => candidate.id === peerId,
        );
        return {
          isRemotePeer: this.remotePeerIds.has(peerId),
          isConnected: this.webrtcConnectedPeerIds.has(peerId),
          hasRemoteAudio: this.webrtcAudioPeerIds.has(peerId),
          isRemoteMuted: member?.isMuted ?? false,
          isRemoteSpeaking: member?.speakingState === MemberSpeakingState.Speaking,
          iceState: this.peers.get(peerId)?.connection.iceConnectionState ?? "new",
        };
      },
      getRecovery: (peerId) => this.peerRecovery.getSnapshot(peerId),
      getResources: () => collectLongSessionAudioResources(this.localStream, this.peers),
      onLatency: (peerId, latencyMs) => this.options.onPeerLatency?.(peerId, latencyMs),
      onStats: (stats) => this.options.onPeerStats?.(stats),
      onFlowEvaluation: (peerId, stats, evaluation) =>
        this.handlePeerAudioFlowEvaluation(peerId, stats, evaluation),
      onAdaptationChanged: logPeerNetworkAdaptation,
    });
    this.peerRecovery = new PeerRecoveryCoordinator({
      localPeerId: options.peerId,
      roomId: options.roomId,
      peers: this.peers,
      remotePeerIds: this.remotePeerIds,
      connectedPeerIds: this.webrtcConnectedPeerIds,
      readyPeerIds: this.webrtcReadyPeerIds,
      operationQueue: this.peerOperationQueue,
      canRecover: () => this.shouldReconnect && this.isSignalingConnected,
      replacePeer: (peerId) => this.replacePeer(peerId),
      applyScreenShare: (peer) => this.screenShareCoordinator.applyToPeer(peer),
      notifyScreenShare: (peerId) => this.screenShareCoordinator.notifyPeer(peerId),
      send: (payload) => this.send(payload),
    });
    this.reconnectCoordinator = createSignalingReconnectCoordinator({
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      getConnectionGeneration: () => this.connectionGeneration,
      onAttempt: (attempt) => this.options.onReconnectAttempt?.(attempt),
    });
  }

  connect(): Promise<void> {
    this.shouldReconnect = true;
    return this.openSocket(false);
  }

  retryReconnect(): boolean {
    return this.reconnectCoordinator.retryNow(
      () => this.openSocket(true),
      () => this.shouldReconnect && !this.isSignalingConnected && !this.isDisconnecting,
    );
  }

  async disconnect(): Promise<void> {
    if (this.isDisconnecting) {
      return;
    }
    this.isDisconnecting = true;
    this.shouldReconnect = false;
    this.clearPendingConnection();
    this.stopSnapshotRecovery();
    this.stopHeartbeat();
    this.stopAudioPathSync();
    this.stopPeerStats();
    this.reconnectCoordinator.dispose();

    if (this.isSignalingConnected) {
      await this.safeSend({
        type: "leave_channel",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
      });
    }

    this.clearPeers();
    if (this.screenShareCoordinator.activeStream) {
      await this.restorePrimaryInputTrack();
    }
    this.screenShareCoordinator.stopTracks();
    this.audioFallback?.destroy();
    this.audioFallback = undefined;
    this.remotePeerIds.clear();
    this.webrtcConnectedPeerIds.clear();
    this.webrtcAudioPeerIds.clear();
    this.webrtcFlowingPeerIds.clear();
    this.webrtcReadyPeerIds.clear();
    this.webrtcStalledPeerIds.clear();
    this.webrtcScreenPeerIds.clear();
    this.relayRequestedByPeerIds.clear();
    this.advertisedRelayNeeds.clear();
    this.screenShareCoordinator.clear();
    this.peerStatsMonitor.stop();
    this.pendingIceCandidates.clear();
    this.peerOperationQueue.clear();
    this.chatTransport.rejectPending("room_client_disconnected");
    this.isSignalingConnected = false;
    await this.signalingBridge.close();
    this.options.onConnectionState(RoomConnectionState.Disconnected);
  }

  canSendChat(): boolean {
    return this.isSignalingConnected && this.joinAckReceived && !this.isDisconnecting;
  }

  getDiagnostics() {
    const reconnect = this.reconnectCoordinator.getSnapshot();
    return buildRoomDiagnosticsFromSources({
      currentPeerId: this.options.peerId,
      reconnectAttempts: reconnect.attempts,
      connectionGeneration: this.connectionGeneration,
      reconnectEpisodeId: reconnect.episodeId,
      reconnectEpisodeActive: reconnect.episodeActive,
      reconnectStableSince: reconnect.stableSince,
      socket: {
        lastSocketCloseCode: this.lastSocketCloseCode,
        lastSocketCloseReason: this.lastSocketCloseReason,
        lastSocketClosedAt: this.lastSocketClosedAt,
      },
      audioRelayActive: Boolean(this.audioFallback),
      remotePeerIds: this.remotePeerIds,
      roomSnapshotRevision: this.lastSnapshotRevision,
      chatSendFailures: this.chatTransport.getFailureCount(),
      join: {
        joinStage: this.joinStage,
        wsOpened: this.wsOpened,
        joinChannelSent: this.joinChannelSent,
        joinAckReceived: this.joinAckReceived,
        roomSnapshotReceived: this.roomSnapshotReceived,
        lastServerError: this.lastServerError,
      },
      screenShareRelayActive: this.screenShareCoordinator.relayActive,
      screenShareRelayTargetCount: this.screenShareCoordinator.relayTargetCount,
      screenShare: this.screenShareCoordinator.diagnostics,
      audioRelayDiagnostics: this.audioFallback?.getDiagnostics(),
      webrtcReadyPeerIds: this.webrtcReadyPeerIds,
      webrtcConnectedPeerIds: this.webrtcConnectedPeerIds,
      webrtcAudioPeerIds: this.webrtcAudioPeerIds,
      webrtcFlowingPeerIds: this.webrtcFlowingPeerIds,
      peerRecoveryAttempts: this.peerRecovery.getAttempts(),
      peerConnectionStats: this.peerStatsMonitor.getStats(),
      peerHealth: this.peerStatsMonitor.getPeerHealth(),
      longSessionAudio: this.peerStatsMonitor.getLongSessionAudioTrend(),
      peerAdaptationTiers: this.peerStatsMonitor.getAdaptationTiers(),
      remoteAudioMixer: getRemoteAudioMixer().getDiagnostics(),
      turnConfigured: this.hasTurnServer,
    });
  }

  async injectFault(command: RealtimeFaultCommand): Promise<void> {
    if (!import.meta.env.DEV) throw new Error("fault_lab_unavailable_in_packaged_app");
    if (
      command.kind === "signal_disconnect" ||
      command.kind === "stale_socket_close" ||
      command.kind === "duplicate_socket_close"
    ) {
      await this.signalingBridge.injectFault(command);
      return;
    }
    if (command.kind === "snapshot_timeout") {
      this.roomSnapshotReceived = false;
      this.startSnapshotRecovery();
      return;
    }
    if (command.kind === "one_peer_audio_stall") {
      const peerId = command.peerId ?? this.remotePeerIds.values().next().value;
      if (!peerId) throw new Error("fault_lab_peer_required");
      this.peerRecovery.schedule(peerId, "fault_lab_one_peer_audio_stall");
      return;
    }
    if (command.kind === "screen_track_lost") {
      const track = this.screenShareCoordinator.activeStream?.getVideoTracks()[0];
      if (!track) throw new Error("fault_lab_screen_track_required");
      track.stop();
      track.dispatchEvent(new Event("ended"));
    }
  }

  updateMuteState(isMuted: boolean, isSpeaking: boolean): void {
    if (this.lastPublishedMuteState === isMuted && this.lastPublishedSpeakingState === isSpeaking) {
      return;
    }

    this.lastPublishedMuteState = isMuted;
    this.lastPublishedSpeakingState = isSpeaking;
    this.audioFallback?.setMuted(isMuted);
    void this.safeSend({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isMuted,
      isSpeaking,
    });
  }

  updateProfile(nickname: string, avatarDataUrl?: string, avatarId?: BuiltInAvatarId): void {
    if (
      this.lastPublishedNickname === nickname &&
      this.lastPublishedAvatarDataUrl === avatarDataUrl &&
      this.lastPublishedAvatarId === avatarId
    ) {
      return;
    }

    this.nickname = nickname;
    this.avatarDataUrl = avatarDataUrl;
    this.avatarId = avatarId;
    this.lastPublishedNickname = nickname;
    this.lastPublishedAvatarDataUrl = avatarDataUrl;
    this.lastPublishedAvatarId = avatarId;

    void this.safeSend({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      nickname,
      avatarId,
    });
  }

  async replaceInputTrack(nextTrack: MediaStreamTrack): Promise<void> {
    const previousPrimaryTrack = this.primaryInputTrack;
    this.primaryInputTrack = nextTrack;
    const systemAudioTrack = this.screenShareCoordinator.activeStream?.getAudioTracks()[0];
    if (systemAudioTrack) {
      await this.applyScreenAudioMix(nextTrack, systemAudioTrack);
    } else {
      await this.applyOutgoingAudioTrack(nextTrack);
    }
    if (previousPrimaryTrack && previousPrimaryTrack.id !== nextTrack.id) {
      previousPrimaryTrack.stop();
    }
  }

  setPeerVolume(peerId: string, volume: number): void {
    this.peerVolumes.set(peerId, clampMemberVolume(volume));
  }

  private openSocket(isReconnect: boolean): Promise<void> {
    this.options.onConnectionState(
      isReconnect ? RoomConnectionState.Reconnecting : RoomConnectionState.Joining,
    );
    this.joinStage = "websocket_open";
    this.wsOpened = false;
    this.joinChannelSent = false;
    this.joinAckReceived = false;
    this.roomSnapshotReceived = false;
    this.lastServerError = undefined;
    this.presenceCoordinator.resetPublication();

    return new Promise((resolve, reject) => {
      this.clearPendingConnection();
      const timeout = window.setTimeout(() => {
        const error = new Error(this.wsOpened ? "join_ack_timeout" : "network_unreachable");
        this.rejectPendingConnection(error);
        void this.signalingBridge.close();
      }, INITIAL_CONNECT_TIMEOUT_MS);

      this.pendingConnection = { resolve, reject, timeout };
      void this.signalingBridge
        .connect(
          this.options.signalingUrl,
          async (payload) => {
            this.options.onDiagnosticEvent?.(payload);
            await this.handleBridgeEvent(payload);
          },
          (error) => this.handleBridgeFailure(error),
        )
        .catch((error) => {
          this.rejectPendingConnection(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private async handleBridgeEvent(payload: SignalingEventPayload): Promise<void> {
    if (payload.generation !== undefined) this.connectionGeneration = payload.generation;
    if (payload.type === "open") {
      this.isSignalingConnected = true;
      this.wsOpened = true;
      this.joinStage = "join_channel_sent";
      this.options.onConnectionState(
        this.hasJoinedOnce ? RoomConnectionState.Reconnecting : RoomConnectionState.Handshaking,
      );

      await this.send({
        type: "join_channel",
        roomId: this.options.roomId,
        channelId: this.options.roomId,
        peerId: this.options.peerId,
        profileId: this.options.profileId,
        nickname: this.nickname,
        avatarId: this.avatarId ?? "fox",
        appVersion: this.options.appVersion,
        protocolVersion: this.options.protocolVersion,
        buildNumber: this.options.buildNumber,
        sessionToken: this.reconnectSessionToken,
      });
      this.joinChannelSent = true;
      this.startHeartbeat();
      return;
    }

    if (payload.type === "message" && payload.data) {
      try {
        const message = JSON.parse(payload.data) as SignalEnvelope;
        await this.handleSignal(message);
      } catch {
        this.rejectPendingConnection(new Error("invalid_signaling_payload"));
      }
      return;
    }

    if (payload.type === "error") {
      if (!this.hasJoinedOnce) {
        this.rejectPendingConnection(new Error(payload.message || "network_unreachable"));
      }
      return;
    }

    if (payload.type === "close") {
      const reconnect = this.reconnectCoordinator.getSnapshot();
      if (!this.isSignalingConnected && (reconnect.reconnectPending || reconnect.episodeActive)) {
        void writeRendererLog(
          "signaling",
          "info",
          "Ignored duplicate socket close in reconnect episode",
          {
            code: payload.code,
            reconnectEpisodeId: reconnect.episodeId,
            connectionGeneration: this.connectionGeneration,
          },
        );
        return;
      }
      this.lastSocketCloseCode = payload.code;
      this.lastSocketCloseReason = payload.reason;
      this.lastSocketClosedAt = new Date().toISOString();
      this.stopHeartbeat();
      this.stopAudioPathSync();
      this.stopSnapshotRecovery();
      this.isSignalingConnected = false;
      this.joinAckReceived = false;
      this.advertisedRelayNeeds.clear();
      this.audioFallback?.resetTransport("signaling_socket_closed");
      this.reconnectCoordinator.cancelStableWindow();

      if (payload.code === 4400) {
        const error = new Error("signaling_protocol_rejected");
        this.shouldReconnect = false;
        this.rejectPendingConnection(error);
        this.options.onConnectionState(RoomConnectionState.Failed);
        this.options.onReconnectExhausted?.(error);
        return;
      }

      if (!this.shouldReconnect) {
        return;
      }

      if (!this.hasJoinedOnce) {
        this.rejectPendingConnection(new Error("signaling_socket_closed"));
        this.options.onConnectionState(RoomConnectionState.Failed);
        return;
      }

      this.clearPendingConnection();
      this.reconnectCoordinator.beginEpisode();
      this.options.onConnectionState(
        this.webrtcReadyPeerIds.size > 0
          ? RoomConnectionState.Degraded
          : RoomConnectionState.Reconnecting,
      );
      this.reconnect();
    }
  }

  private async handleSignal(payload: SignalEnvelope): Promise<void> {
    switch (payload.type) {
      case "join_ack":
        this.handleJoinAck(payload);
        return;
      case "room_snapshot":
      case "channel_snapshot":
        await this.handleRoomSnapshot(payload);
        return;
      case "pong":
        this.handlePong(payload);
        return;
      case "peer_offer":
        await this.handlePeerOffer(payload);
        return;
      case "peer_answer":
        await this.handlePeerAnswer(payload);
        return;
      case "peer_restart_request":
        await this.handlePeerRestartRequest(payload);
        return;
      case "ice_candidate":
        await this.handleIceCandidate(payload);
        return;
      case "error":
        this.handleErrorMessage(payload);
        return;
      case "chat_message":
        this.chatTransport.handleMessage(payload);
        return;
      case "chat_ack":
        this.chatTransport.handleAck(payload);
        return;
      case "chat_rejected":
        this.chatTransport.handleRejected(payload);
        return;
      case "chat_recall":
        this.chatTransport.handleRecall(payload);
        return;
      case "chat_history":
        this.chatTransport.handleHistory(payload);
        return;
      case "channel_counts":
        this.options.onChannelCounts(payload.counts);
        return;
      case "daily_room_reports":
        this.options.onDailyRoomReports(payload.targetRoomId, payload.reports);
        return;
      case "room_collection_snapshot":
        this.memberEvents.handleCollection(payload);
        return;
      case "knock_event":
        this.memberEvents.handleKnock(payload);
        return;
      case "audio_chunk":
        this.handleAudioChunk(payload);
        return;
      case "audio_path_state":
        this.handleAudioPathState(payload);
        return;
      case "audio_resync_request":
        this.audioFallback?.handleResyncRequest(payload);
        return;
      case "audio_resync_ack":
        this.audioFallback?.handleResyncAck(payload);
        return;
      case "screen_frame":
        this.handleScreenFrame(payload);
        return;
      case "screen_share_state":
        this.handleScreenShareState(payload);
        return;
      case "screen_path_state":
        this.handleScreenPathState(payload);
        return;
      case "scene_reaction":
        this.memberEvents.handleReaction(payload);
        return;
      case "member_state":
        this.memberEvents.handleMemberState(payload);
        return;
      case "avatar_update":
        this.memberEvents.handleAvatar(payload);
        return;
      default:
        return;
    }
  }

  updatePresenceState(
    isDeafened: boolean,
    activity: MemberActivity,
    sceneZone?: SceneZoneId,
    gameName?: string,
    musicActivity?: MusicActivity,
    gameIconDataUrl?: string,
    workActivity?: WorkActivity,
  ): void {
    // Keep the coordinator's member snapshot in lockstep with the optimistic UI.
    // Otherwise, an unrelated peer event received before our server echo can replay
    // the local member's previous seat and make the character briefly jump back.
    this.memberEvents.updateLocalPresence(
      isDeafened,
      activity,
      sceneZone,
      gameName,
      musicActivity,
      gameIconDataUrl,
      workActivity,
    );
    this.presenceCoordinator.update(
      isDeafened,
      activity,
      sceneZone,
      gameName,
      musicActivity,
      gameIconDataUrl,
      workActivity,
    );
  }
  /** Kept as a narrow compatibility seam for reconnect replay and focused tests. */
  private publishDesiredPresence(): Promise<void> {
    return this.presenceCoordinator.publish();
  }

  async startScreenShare(
    stream: MediaStream,
    profile: ScreenShareEncodingProfile = DEFAULT_SCREEN_SHARE_PROFILE,
  ): Promise<void> {
    await this.screenShareCoordinator.start(stream, profile);
  }
  async stopScreenShare(stopTracks = true): Promise<void> {
    await this.screenShareCoordinator.stop(stopTracks);
  }
  setScreenShareViewingActive(active: boolean): void {
    this.screenShareCoordinator.setViewingActive(active);
  }
  private handleJoinAck(payload: JoinAckMessage): void {
    if (payload.roomId !== this.options.roomId || payload.peerId !== this.options.peerId) {
      return;
    }

    this.joinAckReceived = true;
    this.serverBuildNumber = payload.buildNumber;
    this.reconnectSessionToken = payload.sessionToken;
    this.hasJoinedOnce = true;
    this.joinStage = "join_ack_received";
    this.options.onConnectionState(RoomConnectionState.WaitingSnapshot);
    this.resolvePendingConnection();
    this.startSnapshotRecovery();
    void this.presenceCoordinator.publish();
    this.chatTransport.retryPending();
    const relayIceServers =
      payload.iceServers?.map((server) => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential,
      })) ?? [];
    this.hasTurnServer = relayIceServers.length > 0;
    this.iceServers = this.hasTurnServer ? [...DEFAULT_ICE_SERVERS, ...relayIceServers] : undefined;
    void writeRendererLog("signaling", "info", "Join acknowledgement received", {
      roomId: payload.roomId,
      peerId: payload.peerId,
      revision: payload.revision,
      memberCount: payload.memberCount,
      protocolVersion: payload.protocolVersion,
      buildNumber: payload.buildNumber,
      turnConfigured: this.hasTurnServer,
      iceServerCount: this.iceServers?.length ?? DEFAULT_ICE_SERVERS.length,
    });
  }

  private async handleRoomSnapshot(
    snapshot: RoomSnapshotMessage | ChannelSnapshotMessage,
  ): Promise<void> {
    if (snapshot.revision <= this.lastSnapshotRevision) {
      void writeRendererLog("signaling", "warn", "Ignored stale room snapshot", {
        roomId: snapshot.roomId,
        revision: snapshot.revision,
        lastSnapshotRevision: this.lastSnapshotRevision,
      });
      return;
    }
    this.lastSnapshotRevision = snapshot.revision;
    this.roomSnapshotReceived = true;
    this.joinStage = "room_snapshot_received";
    this.stopSnapshotRecovery();
    this.options.onSnapshotRevision?.(snapshot.revision);
    this.options.onRoomName(snapshot.roomName);
    const normalizedMembers = normalizeRoomMembers(
      snapshot.members,
      this.options.peerId,
      (peerId) => this.memberEvents.getAvatar(peerId)?.avatarDataUrl,
    );

    this.memberEvents.setMembers(normalizedMembers);
    this.options.onMembers(normalizedMembers);
    this.options.onConnectionState(
      normalizedMembers.filter((member) => !member.isEmptySlot).length <= 1
        ? RoomConnectionState.WaitingPeer
        : RoomConnectionState.Connected,
    );
    this.reconnectCoordinator.beginStableWindow(
      () => this.isSignalingConnected && this.roomSnapshotReceived,
    );
    this.hasJoinedOnce = true;
    this.joinAckReceived = true;
    this.resolvePendingConnection();

    const activePeerIds = collectActivePeerIds(normalizedMembers, this.options.peerId);
    this.remotePeerIds.clear();
    activePeerIds.forEach((peerId) => this.remotePeerIds.add(peerId));
    for (const peerId of [...this.relayRequestedByPeerIds]) {
      if (!activePeerIds.has(peerId)) this.relayRequestedByPeerIds.delete(peerId);
    }
    for (const peerId of [...this.advertisedRelayNeeds.keys()]) {
      if (!activePeerIds.has(peerId)) this.advertisedRelayNeeds.delete(peerId);
    }
    this.screenShareCoordinator.prune(activePeerIds);
    this.startAudioRelay();
    this.startAudioPathSync();
    this.updateAudioRelaySending();
    for (const peerId of activePeerIds) {
      this.advertiseAudioPathState(peerId, !this.webrtcReadyPeerIds.has(peerId), "snapshot_sync");
    }

    for (const peerId of [...this.peers.keys()]) {
      if (!activePeerIds.has(peerId)) {
        const peer = this.peers.get(peerId);
        this.peers.delete(peerId);
        this.peerStatsMonitor.forgetPeer(peerId);
        this.peerRecovery.clear(peerId, true);
        peer?.destroy();
        this.webrtcConnectedPeerIds.delete(peerId);
        this.webrtcAudioPeerIds.delete(peerId);
        this.webrtcFlowingPeerIds.delete(peerId);
        this.webrtcReadyPeerIds.delete(peerId);
        this.webrtcStalledPeerIds.delete(peerId);
        this.webrtcScreenPeerIds.delete(peerId);
        this.pendingIceCandidates.delete(peerId);
        this.relayRequestedByPeerIds.delete(peerId);
        this.advertisedRelayNeeds.delete(peerId);
        this.screenShareCoordinator.clearPeer(peerId);
        this.audioFallback?.clearPeer(peerId, "peer_left_room");
        this.options.onRemoteStream(peerId, undefined);
        this.options.onRemoteScreenFrame(peerId, undefined);
        this.options.onRemoteScreenShareState(peerId, false);
      }
    }

    for (const member of normalizedMembers) {
      if (member.id === this.options.peerId || this.peers.has(member.id)) {
        continue;
      }

      if (this.options.peerId < member.id) {
        await this.enqueuePeerOperation(member.id, "snapshot_offer", async () => {
          if (!this.remotePeerIds.has(member.id) || this.peers.has(member.id)) {
            return;
          }
          const peer = this.createPeer(member.id);
          await this.screenShareCoordinator.applyToPeer(peer);
          const offer = await peer.createOffer();
          await this.send({
            type: "peer_offer",
            roomId: this.options.roomId,
            peerId: this.options.peerId,
            targetPeerId: member.id,
            sdp: offer,
          });
        });
      }
    }
  }

  private async handlePeerOffer(payload: PeerOfferMessage): Promise<void> {
    await this.enqueuePeerOperation(payload.peerId, "accept_offer", async () => {
      if (!this.remotePeerIds.has(payload.peerId)) {
        return;
      }
      const existing = this.peers.get(payload.peerId);
      let peer =
        !existing ||
        existing.connection.connectionState === "failed" ||
        existing.connection.connectionState === "closed"
          ? this.replacePeer(payload.peerId)
          : existing;
      await this.screenShareCoordinator.applyToPeer(peer);
      let answer;
      try {
        answer = await peer.acceptOffer(payload.sdp);
      } catch (error) {
        if (this.peers.get(payload.peerId) !== peer) {
          return;
        }
        void writeRendererLog("webrtc", "warn", "Retrying peer offer on a clean connection", {
          peerId: payload.peerId,
          signalingState: peer.connection.signalingState,
          error: error instanceof Error ? error.message : String(error),
        });
        peer = this.replacePeer(payload.peerId);
        await this.screenShareCoordinator.applyToPeer(peer);
        answer = await peer.acceptOffer(payload.sdp);
      }

      await this.send({
        type: "peer_answer",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
        targetPeerId: payload.peerId,
        sdp: answer,
      });
    });
  }

  private async handlePeerAnswer(payload: PeerAnswerMessage): Promise<void> {
    await this.enqueuePeerOperation(payload.peerId, "accept_answer", async () => {
      const peer = this.peers.get(payload.peerId);
      if (!peer || !this.remotePeerIds.has(payload.peerId)) {
        return;
      }
      await peer.acceptAnswer(payload.sdp);
    });
  }

  private async handlePeerRestartRequest(payload: PeerRestartRequestMessage): Promise<void> {
    await this.peerRecovery.handleRemoteRequest(payload);
  }

  private async handleIceCandidate(payload: IceCandidateMessage): Promise<void> {
    await this.enqueuePeerOperation(payload.peerId, "ice_candidate", async () => {
      const peer = this.peers.get(payload.peerId);
      if (!peer) {
        const pending = this.pendingIceCandidates.get(payload.peerId) ?? [];
        pending.push(payload.candidate);
        this.pendingIceCandidates.set(payload.peerId, pending.slice(-64));
        void writeRendererLog("webrtc", "info", "ICE candidate buffered before peer creation", {
          peerId: payload.peerId,
          pendingCount: pending.length,
        });
        return;
      }

      await peer.addIceCandidate(payload.candidate);
    });
  }

  private handleErrorMessage(payload: ErrorMessage): void {
    this.lastServerError = `${payload.code}:${payload.message}`;
    const decision = decideSignalingError(payload, {
      hasJoinedOnce: this.hasJoinedOnce,
      joinAckReceived: this.joinAckReceived,
      appVersion: this.options.appVersion,
    });
    if (decision.updateRequired) {
      this.options.onUpdateRequired?.(
        decision.updateRequired.requiredVersion,
        decision.updateRequired.currentVersion,
      );
    }
    if (decision.avatarConflict) {
      this.options.onAvatarConflict?.(decision.avatarConflict.availableAvatarIds ?? []);
    }
    if (decision.ignore) return;
    if (decision.stopReconnect) this.shouldReconnect = false;
    this.options.onConnectionState(RoomConnectionState.Failed);
    this.rejectPendingConnection(new Error(decision.reason ?? "signaling_error"));
  }

  async sendChatMessage(
    content: string,
    image?: ChatImageAttachment,
    clientMessageId: string = crypto.randomUUID(),
  ): Promise<ChatAckMessage> {
    return this.chatTransport.sendMessage(content, image, clientMessageId);
  }

  async requestDailyRoomReports(targetRoomId: "main" | "side"): Promise<boolean> {
    if (!this.canSendChat()) throw new Error("signaling_not_connected");
    // 2.5.x servers share protocol 7 but do not know this additive message.
    // Sending it would make the legacy server return invalid_payload, which in
    // turn marks the entire room connection failed and disables chat.
    if (!serverBuildSupportsDailyRoomReports(this.serverBuildNumber)) return false;
    await this.send({
      type: "request_daily_room_reports",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetRoomId,
    });
    return true;
  }

  async recallChatMessage(messageId: string): Promise<void> {
    await this.socialTransport.recall(messageId);
  }

  async addRoomCollectionItem(
    kind: RoomCollectionItem["kind"],
    title: string,
    content: string,
  ): Promise<void> {
    await this.socialTransport.addCollection(kind, title, content);
  }

  async removeRoomCollectionItem(itemId: string): Promise<void> {
    await this.socialTransport.removeCollection(itemId);
  }

  async sendKnock(): Promise<void> {
    await this.socialTransport.knock();
  }

  async sendSceneReaction(targetPeerId: string, emoji: SceneReaction["emoji"]): Promise<void> {
    await this.socialTransport.react(targetPeerId, emoji);
  }

  private handleAudioChunk(payload: AudioChunkMessage): void {
    if (payload.targetPeerIds && !payload.targetPeerIds.includes(this.options.peerId)) {
      return;
    }
    this.audioFallback?.handleRemoteChunk(payload);
  }

  private handleAudioPathState(payload: AudioPathStateMessage): void {
    if (payload.targetPeerId !== this.options.peerId || !this.remotePeerIds.has(payload.peerId)) {
      return;
    }
    if (payload.needsRelay) {
      this.relayRequestedByPeerIds.add(payload.peerId);
    } else {
      this.relayRequestedByPeerIds.delete(payload.peerId);
    }
    this.updateAudioRelaySending();
    void writeRendererLog("audio", "info", "Remote peer audio path request updated", {
      peerId: payload.peerId,
      needsRelay: payload.needsRelay,
      reason: payload.reason,
      activeRelayRequests: this.relayRequestedByPeerIds.size,
    });
  }

  private handleScreenFrame(payload: ScreenFrameMessage): void {
    this.screenShareCoordinator.handleFrame(payload);
  }

  private handleScreenShareState(payload: ScreenShareStateMessage): void {
    this.screenShareCoordinator.handleRemoteState(payload);
  }

  private handleScreenPathState(payload: ScreenPathStateMessage): void {
    this.screenShareCoordinator.handlePathState(payload);
  }

  private startAudioRelay(): void {
    if (this.audioFallback) {
      return;
    }

    this.audioFallback = new AudioFallbackController({
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      localStream: this.localStream,
      send: (message) => this.send(message),
      shouldPlayPeer: (peerId) => !getRemoteAudioMixer().hasVerifiedWebRtcPlayback(peerId),
      getTargetPeerIds: () => this.getAudioRelayTargetPeerIds(),
      getPeerVolume: (peerId) => this.peerVolumes.get(peerId) ?? 1,
      onLog: (level, message, context) => {
        void writeRendererLog("audio", level, message, context);
      },
    });
    this.audioFallback.setMuted(this.lastPublishedMuteState ?? false);
    void this.audioFallback.start().catch((error) => {
      void writeRendererLog("audio", "warn", "Failed to start signaling audio relay", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private updateAudioRelaySending(): void {
    this.audioFallback?.setShouldSend(this.getAudioRelayTargetPeerIds().length > 0);
  }

  private getAudioRelayTargetPeerIds(): string[] {
    return [...this.remotePeerIds].filter((peerId) =>
      shouldSendAudioRelay({
        evidence: {
          isConnected: this.webrtcConnectedPeerIds.has(peerId),
          hasAudioTrack: this.webrtcAudioPeerIds.has(peerId),
          hasInboundRtpFlow: this.webrtcFlowingPeerIds.has(peerId),
          hasPlaybackChannel: getRemoteAudioMixer().hasVerifiedWebRtcPlayback(peerId),
          isStalled: this.webrtcStalledPeerIds.has(peerId),
        },
        isRelayRequested: this.relayRequestedByPeerIds.has(peerId),
      }),
    );
  }

  private createPeer(targetPeerId: string): MeshPeerConnection {
    const peer = new MeshPeerConnection({
      peerId: targetPeerId,
      localStream: this.localStream,
      iceServers: this.iceServers,
      onRemoteStream: (stream) => {
        if (this.peers.get(targetPeerId) !== peer) {
          return;
        }
        const hasPlayableAudio = hasPlayableAudioTrack(stream);
        const hasLiveScreen = stream
          .getVideoTracks()
          .some((track) => track.readyState === "live" && track.enabled);
        if (hasPlayableAudio) {
          this.webrtcAudioPeerIds.add(targetPeerId);
        } else {
          this.webrtcAudioPeerIds.delete(targetPeerId);
          this.webrtcFlowingPeerIds.delete(targetPeerId);
        }
        if (hasLiveScreen) {
          this.webrtcScreenPeerIds.add(targetPeerId);
        } else {
          this.webrtcScreenPeerIds.delete(targetPeerId);
        }
        this.screenShareCoordinator.syncPeerTrack(targetPeerId, hasLiveScreen);
        this.options.onRemoteStream(targetPeerId, stream);
        this.syncPeerMediaPath(
          targetPeerId,
          hasPlayableAudio ? "remote_audio_track_playable" : "remote_audio_track_unavailable",
        );
        if (hasPlayableAudio) {
          for (const delayMs of [0, 160]) {
            window.setTimeout(() => {
              if (this.peers.get(targetPeerId) === peer && this.remotePeerIds.has(targetPeerId)) {
                this.syncPeerMediaPath(targetPeerId, "remote_playback_graph_sync");
              }
            }, delayMs);
          }
        }
      },
      onIceCandidate: (candidate) => {
        if (this.peers.get(targetPeerId) !== peer) {
          return;
        }
        void this.safeSend({
          type: "ice_candidate",
          roomId: this.options.roomId,
          peerId: this.options.peerId,
          targetPeerId,
          candidate,
        });
      },
      onConnectionStateChange: (state) => {
        if (this.peers.get(targetPeerId) !== peer) {
          return;
        }
        if (state === "connected") {
          this.webrtcConnectedPeerIds.add(targetPeerId);
          // A connected ICE/DTLS transport is healthy even while the friend is silent or muted.
          // Audio readiness still controls relay fallback, but it must not rebuild the peer forever.
          this.peerRecovery.clear(targetPeerId, true);
          this.webrtcFlowingPeerIds.delete(targetPeerId);
          this.peerStatsMonitor.markConnected(targetPeerId);
          this.webrtcStalledPeerIds.delete(targetPeerId);
          this.syncPeerMediaPath(targetPeerId, "webrtc_connected");
          void writeRendererLog("webrtc", "info", "Peer connection connected", {
            targetPeerId,
            remoteAudioTrackReady: this.webrtcAudioPeerIds.has(targetPeerId),
            audioRelayFallbackEnabled: !this.webrtcReadyPeerIds.has(targetPeerId),
          });
          return;
        }

        if (state === "failed" || state === "disconnected" || state === "closed") {
          this.webrtcConnectedPeerIds.delete(targetPeerId);
          this.webrtcAudioPeerIds.delete(targetPeerId);
          this.webrtcFlowingPeerIds.delete(targetPeerId);
          this.webrtcReadyPeerIds.delete(targetPeerId);
          this.webrtcStalledPeerIds.delete(targetPeerId);
          this.webrtcScreenPeerIds.delete(targetPeerId);
          this.peerStatsMonitor.markDisconnected(targetPeerId);
          this.audioFallback?.markPeerPath(targetPeerId, "relay", `webrtc_${state}`);
          this.updateAudioRelaySending();
          this.options.onRemoteStream(targetPeerId, undefined);
          if (this.isSignalingConnected && this.remotePeerIds.has(targetPeerId)) {
            this.options.onConnectionState(RoomConnectionState.Degraded);
          }
          void writeRendererLog(
            "webrtc",
            "warn",
            "Peer connection unavailable, audio relay fallback enabled",
            {
              targetPeerId,
              state,
              audioRelayFallbackEnabled: true,
            },
          );
          if (state !== "closed") {
            this.peerRecovery.schedule(targetPeerId, `connection_${state}`);
          }
        }
      },
      onDiagnosticEvent: (event, context) => {
        void writeRendererLog(
          "webrtc",
          event === "connection_state" && context.state === "failed" ? "warn" : "info",
          `WebRTC ${event}`,
          context,
        );
      },
    });

    this.peers.set(targetPeerId, peer);
    const pendingCandidates = this.pendingIceCandidates.get(targetPeerId);
    if (pendingCandidates?.length) {
      this.pendingIceCandidates.delete(targetPeerId);
      void Promise.allSettled(
        pendingCandidates.map((candidate) => peer.addIceCandidate(candidate)),
      ).then((results) => {
        void writeRendererLog("webrtc", "info", "Buffered ICE candidates handed to peer", {
          targetPeerId,
          candidateCount: results.length,
          failedCount: results.filter((result) => result.status === "rejected").length,
        });
      });
    }
    this.peerRecovery.watchConnection(targetPeerId, peer);
    return peer;
  }

  private replacePeer(targetPeerId: string): MeshPeerConnection {
    const existing = this.peers.get(targetPeerId);
    if (existing) {
      this.peers.delete(targetPeerId);
      existing.destroy();
    }
    this.peerStatsMonitor.forgetPeer(targetPeerId);
    this.peerRecovery.clear(targetPeerId);
    this.webrtcConnectedPeerIds.delete(targetPeerId);
    this.webrtcAudioPeerIds.delete(targetPeerId);
    this.webrtcFlowingPeerIds.delete(targetPeerId);
    this.webrtcReadyPeerIds.delete(targetPeerId);
    this.webrtcStalledPeerIds.delete(targetPeerId);
    this.webrtcScreenPeerIds.delete(targetPeerId);
    this.options.onRemoteStream(targetPeerId, undefined);
    return this.createPeer(targetPeerId);
  }

  private syncPeerMediaPath(targetPeerId: string, reason: string): void {
    const isReady = isPeerAudioPathReady({
      isConnected: this.webrtcConnectedPeerIds.has(targetPeerId),
      hasAudioTrack: this.webrtcAudioPeerIds.has(targetPeerId),
      hasInboundRtpFlow: this.webrtcFlowingPeerIds.has(targetPeerId),
      hasPlaybackChannel: getRemoteAudioMixer().hasVerifiedWebRtcPlayback(targetPeerId),
      isStalled: this.webrtcStalledPeerIds.has(targetPeerId),
    });
    const wasReady = this.webrtcReadyPeerIds.has(targetPeerId);

    if (isReady) {
      this.webrtcReadyPeerIds.add(targetPeerId);
      this.advertiseAudioPathState(targetPeerId, false, reason);
      this.peerRecovery.clear(targetPeerId, true);
      if (!wasReady) {
        this.audioFallback?.markPeerPath(targetPeerId, "webrtc", reason);
        void writeRendererLog("webrtc", "info", "Remote audio RTP flow is verified", {
          targetPeerId,
          reason,
          audioRelayFallbackEnabled: false,
        });
      }
      this.updateAudioRelaySending();
      if (
        this.remotePeerIds.size > 0 &&
        [...this.remotePeerIds].every((peerId) => this.webrtcReadyPeerIds.has(peerId))
      ) {
        this.options.onConnectionState(RoomConnectionState.Connected);
      }
      return;
    }

    this.webrtcReadyPeerIds.delete(targetPeerId);
    this.advertiseAudioPathState(targetPeerId, true, reason);
    if (wasReady) {
      this.audioFallback?.markPeerPath(targetPeerId, "relay", reason);
      this.updateAudioRelaySending();
      if (this.isSignalingConnected && this.remotePeerIds.has(targetPeerId)) {
        this.options.onConnectionState(RoomConnectionState.Degraded);
        this.peerRecovery.schedule(targetPeerId, "remote_audio_unavailable");
      }
      void writeRendererLog("webrtc", "warn", "Remote audio track became unavailable", {
        targetPeerId,
        reason,
        audioRelayFallbackEnabled: true,
      });
    }
  }

  private advertiseAudioPathState(
    targetPeerId: string,
    needsRelay: boolean,
    reason: string,
    force = false,
  ): void {
    if (!this.isSignalingConnected || !this.remotePeerIds.has(targetPeerId)) return;
    if (!force && this.advertisedRelayNeeds.get(targetPeerId) === needsRelay) return;
    this.advertisedRelayNeeds.set(targetPeerId, needsRelay);
    void this.safeSend({
      type: "audio_path_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId,
      needsRelay,
      reason,
    }).catch(() => {
      this.advertisedRelayNeeds.delete(targetPeerId);
    });
  }

  private async send(payload: SignalEnvelope): Promise<void> {
    if (!this.isSignalingConnected) {
      throw new Error("signaling_not_connected");
    }
    await this.signalingBridge.send(payload);
  }

  private handleBridgeFailure(error: unknown): void {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    void writeRendererLog("signaling", "error", "Signaling bridge handler failed", {
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      error: normalizedError.message,
    });
    this.isSignalingConnected = false;
    this.rejectPendingConnection(normalizedError);
    void this.signalingBridge.close();
  }

  private async safeSend(payload: SignalEnvelope): Promise<boolean> {
    if (!this.isSignalingConnected) {
      return false;
    }

    try {
      await this.send(payload);
      return true;
    } catch (error) {
      if (isSignalingSessionSupersededError(error)) {
        this.stopSupersededSession();
        return false;
      }
      void writeRendererLog("signaling", "warn", "Skipped signaling send", {
        type: payload.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * The main process owns one signaling session. If a newer RoomClient takes
   * ownership, this instance can no longer send anything and must become inert.
   * Do not call UI callbacks here because they may already belong to the newer
   * room session and clearing them would erase its members or remote streams.
   */
  private stopSupersededSession(): void {
    if (this.hasLostSignalingOwnership) return;
    this.hasLostSignalingOwnership = true;
    this.shouldReconnect = false;
    this.isSignalingConnected = false;
    this.joinAckReceived = false;
    this.rejectPendingConnection(new Error("signaling_session_superseded"));
    this.stopSnapshotRecovery();
    this.stopHeartbeat();
    this.stopAudioPathSync();
    this.stopPeerStats();
    this.reconnectCoordinator.dispose();
    this.peerRecovery.clearAll();

    for (const peer of this.peers.values()) peer.destroy();
    this.peers.clear();
    this.pendingIceCandidates.clear();
    this.peerOperationQueue.clear();
    this.remotePeerIds.clear();
    this.webrtcConnectedPeerIds.clear();
    this.webrtcAudioPeerIds.clear();
    this.webrtcFlowingPeerIds.clear();
    this.webrtcReadyPeerIds.clear();
    this.webrtcStalledPeerIds.clear();
    this.webrtcScreenPeerIds.clear();
    this.relayRequestedByPeerIds.clear();
    this.advertisedRelayNeeds.clear();

    this.audioFallback?.destroy();
    this.audioFallback = undefined;
    this.screenShareCoordinator.stopTracks();
    this.screenShareCoordinator.clear();
    this.screenAudioMixer.dispose();
    this.chatTransport.rejectPending("signaling_session_superseded");
    void this.signalingBridge.close();
    void writeRendererLog("signaling", "info", "Stopped superseded room client", {
      roomId: this.options.roomId,
      peerId: this.options.peerId,
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.startPeerStats();
    this.heartbeatTimer = window.setInterval(() => {
      void this.safeSend({
        type: "heartbeat",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
        sentAt: Date.now(),
      });
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.stopPeerStats();
  }

  private startAudioPathSync(): void {
    if (this.audioPathSyncTimer) return;
    this.refreshAudioPathHandshake("path_sync_started");
    this.audioPathSyncTimer = window.setInterval(
      () => this.refreshAudioPathHandshake("path_sync_heartbeat"),
      AUDIO_PATH_SYNC_INTERVAL_MS,
    );
  }

  private stopAudioPathSync(): void {
    if (this.audioPathSyncTimer) {
      window.clearInterval(this.audioPathSyncTimer);
      this.audioPathSyncTimer = undefined;
    }
  }

  private refreshAudioPathHandshake(reason: string): void {
    for (const peerId of this.remotePeerIds) {
      this.syncPeerMediaPath(peerId, reason);
      this.advertiseAudioPathState(peerId, !this.webrtcReadyPeerIds.has(peerId), reason, true);
    }
    this.updateAudioRelaySending();
  }

  private startPeerStats(): void {
    this.peerStatsMonitor.start();
  }

  private handlePeerAudioFlowEvaluation(
    peerId: string,
    stats: PeerAudioStats,
    evaluation: InboundAudioFlowEvaluation,
  ): void {
    const wasStalled = this.webrtcStalledPeerIds.has(peerId);
    if (evaluation.status === "stalled") {
      this.webrtcFlowingPeerIds.delete(peerId);
      this.webrtcStalledPeerIds.add(peerId);
      this.syncPeerMediaPath(peerId, "inbound_rtp_stalled");
      if (!wasStalled) {
        void getRemoteAudioMixer().repairPeerPlayback(peerId);
        void writeRendererLog(
          "webrtc",
          "warn",
          "Remote audio RTP stopped; switching to relay and repairing the peer",
          {
            peerId,
            packetsReceived: stats.packetsReceived,
            bytesReceived: stats.bytesReceived,
            stagnantSamples: evaluation.next.stagnantSamples,
          },
        );
        this.peerRecovery.schedule(peerId, "inbound_rtp_stalled");
      }
      return;
    }

    if (evaluation.status === "flowing") {
      const wasFlowing = this.webrtcFlowingPeerIds.has(peerId);
      this.webrtcFlowingPeerIds.add(peerId);
      this.webrtcStalledPeerIds.delete(peerId);
      // RTP growth is stronger transport evidence than decoded loudness. A quiet or
      // muted friend can legitimately produce no non-zero PCM, so leaving the initial
      // connection watchdog armed here would rebuild a healthy peer every few seconds.
      this.peerRecovery.clear(peerId, true);
      this.syncPeerMediaPath(peerId, wasStalled ? "inbound_rtp_resumed" : "inbound_rtp_verified");
      if (!wasFlowing || wasStalled) {
        void writeRendererLog("webrtc", "info", "Remote audio RTP is flowing", {
          peerId,
          status: evaluation.status,
          packetsReceived: stats.packetsReceived,
          bytesReceived: stats.bytesReceived,
        });
      }
    }
  }

  private stopPeerStats(): void {
    this.peerStatsMonitor.stop();
  }

  private handlePong(payload: PongMessage): void {
    const rttMs = Math.max(0, Date.now() - payload.sentAt);
    const midpoint = payload.sentAt + rttMs / 2;
    const serverClockOffsetMs = payload.serverTime - midpoint;
    this.audioFallback?.setServerClockOffsetMs(serverClockOffsetMs);
    this.options.onRtt?.(rttMs);
  }

  private startSnapshotRecovery(): void {
    this.stopSnapshotRecovery();
    this.snapshotRetryTimer = window.setTimeout(() => {
      if (!this.isSignalingConnected || this.roomSnapshotReceived) {
        return;
      }
      this.options.onConnectionState(RoomConnectionState.WaitingSnapshot);
      void writeRendererLog("signaling", "warn", "Room snapshot timeout, requesting recovery", {
        code: "room_snapshot_timeout",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
        lastSnapshotRevision: this.lastSnapshotRevision,
      });
      void this.safeSend({
        type: "request_snapshot",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
      }).then(() => this.startSnapshotRecovery());
    }, SNAPSHOT_RETRY_TIMEOUT_MS);
  }

  private stopSnapshotRecovery(): void {
    if (this.snapshotRetryTimer) {
      window.clearTimeout(this.snapshotRetryTimer);
      this.snapshotRetryTimer = undefined;
    }
  }

  private reconnect(): void {
    this.reconnectCoordinator.schedule(
      () => this.openSocket(true),
      () => this.shouldReconnect,
    );
  }

  private clearPeers(): void {
    this.stopAudioPathSync();
    const existingPeers = [...this.peers];
    this.peers.clear();
    for (const [peerId, peer] of existingPeers) {
      this.peerRecovery.clear(peerId, true);
      peer.destroy();
      this.options.onRemoteStream(peerId, undefined);
      this.options.onRemoteScreenFrame(peerId, undefined);
      this.options.onRemoteScreenShareState(peerId, false);
    }
    this.peerStatsMonitor.stop();
    this.webrtcConnectedPeerIds.clear();
    this.webrtcAudioPeerIds.clear();
    this.webrtcFlowingPeerIds.clear();
    this.webrtcReadyPeerIds.clear();
    this.webrtcStalledPeerIds.clear();
    this.webrtcScreenPeerIds.clear();
    this.pendingIceCandidates.clear();
    this.peerOperationQueue.clear();
    this.relayRequestedByPeerIds.clear();
    this.advertisedRelayNeeds.clear();
    this.screenShareCoordinator.clear();
    this.remotePeerIds.clear();
    this.updateAudioRelaySending();
  }

  private enqueuePeerOperation(
    peerId: string,
    operationName: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    return this.peerOperationQueue.enqueue(peerId, operationName, operation);
  }

  private async applyOutgoingAudioTrack(track: MediaStreamTrack): Promise<void> {
    const nextStream = new MediaStream([track]);
    this.localStream = nextStream;
    await Promise.all([...this.peers.values()].map((peer) => peer.replaceLocalTrack(track)));
    await this.audioFallback?.replaceLocalStream(nextStream);
  }

  private async applyScreenAudioMix(
    microphoneTrack: MediaStreamTrack,
    systemAudioTrack: MediaStreamTrack,
  ): Promise<void> {
    const mixedTrack = await this.screenAudioMixer.mix(microphoneTrack, systemAudioTrack);
    if (mixedTrack) await this.applyOutgoingAudioTrack(mixedTrack);
  }

  private async restorePrimaryInputTrack(): Promise<void> {
    const primaryTrack = this.primaryInputTrack;
    if (primaryTrack?.readyState === "live" && this.screenAudioMixer.hasActiveMix()) {
      await this.applyOutgoingAudioTrack(primaryTrack);
    }
    this.screenAudioMixer.dispose();
  }

  private clearPendingConnection(): void {
    if (!this.pendingConnection) {
      return;
    }

    window.clearTimeout(this.pendingConnection.timeout);
    this.pendingConnection = undefined;
  }

  private resolvePendingConnection(): void {
    if (!this.pendingConnection) {
      return;
    }

    const { resolve, timeout } = this.pendingConnection;
    window.clearTimeout(timeout);
    this.pendingConnection = undefined;
    resolve();
  }

  private rejectPendingConnection(error: Error): void {
    if (!this.pendingConnection) {
      return;
    }

    const { reject, timeout } = this.pendingConnection;
    window.clearTimeout(timeout);
    this.pendingConnection = undefined;
    reject(error);
  }
}
