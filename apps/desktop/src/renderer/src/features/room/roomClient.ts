import {
  DEFAULT_RECONNECT_DELAYS_MS,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  type BuiltInAvatarId,
  type ChatMessage,
  type MemberActivity,
  type RoomMember,
  type SceneReaction,
  type SceneZoneId,
  type SignalingEventPayload,
} from "@private-voice/shared";
import type {
  AudioChunkMessage,
  AudioPathStateMessage,
  AvatarUpdateMessage,
  ChatMessage as SignalChatMessage,
  ChatHistoryMessage,
  ErrorMessage,
  IceCandidateMessage,
  JoinAckMessage,
  KnockEventMessage,
  PongMessage,
  MemberStateMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  PeerRestartRequestMessage,
  RoomSnapshotMessage,
  ChannelSnapshotMessage,
  ScreenFrameMessage,
  ScreenPathStateMessage,
  ScreenShareStateMessage,
  SceneReactionMessage,
  SignalEnvelope,
} from "@private-voice/signaling";
import {
  DEFAULT_ICE_SERVERS,
  DEFAULT_SCREEN_SHARE_PROFILE,
  ExponentialBackoff,
  MeshPeerConnection,
  collectPeerAudioStats,
  evaluateInboundAudioFlow,
  type InboundAudioProgress,
  type NetworkAdaptationTier,
  type PeerAudioStats,
  type ScreenShareEncodingProfile,
} from "@private-voice/webrtc";

import { writeRendererLog } from "../../utils/logger";
import { hasPlayableAudioTrack } from "../audio/remoteAudioTrack";
import { normalizePresenceGameName } from "./presenceSignal";
import { SignalingAudioRelay } from "./signalingAudioRelay";

interface RoomClientOptions {
  signalingUrl: string;
  roomId: string;
  peerId: string;
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
  onChatHistory: (messages: ChatMessage[]) => void;
  onKnock: (message: ChatMessage) => void;
  onRemoteScreenFrame: (peerId: string, frame?: RemoteScreenFrame) => void;
  onSceneReaction: (reaction: SceneReaction) => void;
  onDiagnosticEvent?: (payload: SignalingEventPayload) => void;
  onReconnectAttempt?: (attempt: number) => void;
  onReconnectExhausted?: (error: Error) => void;
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
const SCREEN_FRAME_INTERVAL_MS = 2_500;
const SCREEN_FRAME_MAX_WIDTH = 480;
const SCREEN_FRAME_MAX_BYTES = 48 * 1024;
const PEER_AUDIO_HEALTH_INTERVAL_MS = 1_000;

export class RoomClient {
  private readonly signalingSessionId = crypto.randomUUID();
  private readonly backoff = new ExponentialBackoff(DEFAULT_RECONNECT_DELAYS_MS);
  private readonly peers = new Map<string, MeshPeerConnection>();
  private readonly peerVolumes = new Map<string, number>();
  private heartbeatTimer?: number;
  private peerStatsTimer?: number;
  private snapshotRetryTimer?: number;
  private reconnectTimer?: number;
  private shouldReconnect = true;
  private localStream: MediaStream;
  private nickname: string;
  private avatarDataUrl?: string;
  private avatarId?: BuiltInAvatarId;
  private lastPublishedMuteState?: boolean;
  private lastPublishedSpeakingState?: boolean;
  private lastPublishedDeafenState?: boolean;
  private lastPublishedActivity?: MemberActivity;
  private lastPublishedSceneZone?: SceneZoneId;
  private lastPublishedGameName?: string;
  private lastPublishedNickname: string;
  private lastPublishedAvatarDataUrl?: string;
  private lastPublishedAvatarId?: BuiltInAvatarId;
  private pendingConnection?: PendingConnection;
  private hasJoinedOnce = false;
  private unsubscribeEvents?: () => void;
  private audioRelay?: SignalingAudioRelay;
  private readonly remotePeerIds = new Set<string>();
  private readonly webrtcConnectedPeerIds = new Set<string>();
  private readonly webrtcAudioPeerIds = new Set<string>();
  private readonly webrtcReadyPeerIds = new Set<string>();
  private readonly webrtcStalledPeerIds = new Set<string>();
  private readonly webrtcScreenPeerIds = new Set<string>();
  private readonly relayRequestedByPeerIds = new Set<string>();
  private readonly advertisedRelayNeeds = new Map<string, boolean>();
  private readonly remoteSharingPeerIds = new Set<string>();
  private readonly screenRelayRequestedByPeerIds = new Set<string>();
  private readonly advertisedScreenRelayNeeds = new Map<string, boolean>();
  private readonly peerRecoveryTimers = new Map<string, number>();
  private readonly peerConnectionWatchdogs = new Map<string, number>();
  private readonly peerRecoveryAttempts = new Map<string, number>();
  private readonly pendingIceCandidates = new Map<string, IceCandidateMessage["candidate"][]>();
  private readonly peerStats = new Map<string, PeerAudioStats>();
  private readonly peerAudioProgress = new Map<string, InboundAudioProgress>();
  private readonly peerConnectedAt = new Map<string, number>();
  private readonly peerAdaptationTiers = new Map<string, NetworkAdaptationTier>();
  private reconnectAttempts = 0;
  private lastSnapshotRevision = 0;
  private isSignalingConnected = false;
  private isDisconnecting = false;
  private lastSocketCloseCode?: number;
  private lastSocketCloseReason?: string;
  private lastSocketClosedAt?: string;
  private chatSendFailures = 0;
  private currentMembers: RoomMember[] = [];
  private readonly avatarCache = new Map<string, { avatarHash?: string; avatarDataUrl?: string }>();
  private joinStage = "idle";
  private wsOpened = false;
  private joinChannelSent = false;
  private joinAckReceived = false;
  private roomSnapshotReceived = false;
  private lastServerError?: string;
  private screenShareStream?: MediaStream;
  private screenShareProfile = DEFAULT_SCREEN_SHARE_PROFILE;
  private primaryInputTrack?: MediaStreamTrack;
  private screenAudioContext?: AudioContext;
  private mixedScreenAudioTrack?: MediaStreamTrack;
  private screenFrameVideo?: HTMLVideoElement;
  private screenFrameCanvas?: HTMLCanvasElement;
  private screenFrameTimer?: number;
  private screenFrameIntervalMs?: number;
  private screenFrameSequence = 0;
  private iceServers?: RTCIceServer[];
  private hasTurnServer = false;
  private bridgeEventQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: RoomClientOptions) {
    this.localStream = options.localStream;
    this.primaryInputTrack = options.localStream.getAudioTracks()[0];
    this.nickname = options.nickname;
    this.avatarDataUrl = options.avatarDataUrl;
    this.avatarId = options.avatarId;
    this.lastPublishedNickname = options.nickname;
    this.lastPublishedAvatarDataUrl = options.avatarDataUrl;
    this.lastPublishedAvatarId = options.avatarId;
  }

  connect(): Promise<void> {
    this.shouldReconnect = true;
    return this.openSocket(false);
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
    this.stopPeerStats();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }

    if (this.isSignalingConnected) {
      await this.safeSend({
        type: "leave_channel",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
      });
    }

    this.clearPeers();
    if (this.screenShareStream) {
      await this.restorePrimaryInputTrack();
    }
    this.stopScreenShareTracks();
    this.audioRelay?.destroy();
    this.audioRelay = undefined;
    this.remotePeerIds.clear();
    this.webrtcConnectedPeerIds.clear();
    this.webrtcAudioPeerIds.clear();
    this.webrtcReadyPeerIds.clear();
    this.webrtcStalledPeerIds.clear();
    this.webrtcScreenPeerIds.clear();
    this.relayRequestedByPeerIds.clear();
    this.advertisedRelayNeeds.clear();
    this.remoteSharingPeerIds.clear();
    this.screenRelayRequestedByPeerIds.clear();
    this.advertisedScreenRelayNeeds.clear();
    this.peerAudioProgress.clear();
    this.peerConnectedAt.clear();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.pendingIceCandidates.clear();
    this.bridgeEventQueue = Promise.resolve();
    this.isSignalingConnected = false;
    await window.desktopApi.signaling.close(this.signalingSessionId).catch(() => undefined);
    this.options.onConnectionState(RoomConnectionState.Disconnected);
  }

  canSendChat(): boolean {
    return this.isSignalingConnected && this.joinAckReceived && !this.isDisconnecting;
  }

  getDiagnostics() {
    return {
      currentPeerId: this.options.peerId,
      reconnectAttempts: this.reconnectAttempts,
      lastSocketCloseCode: this.lastSocketCloseCode,
      lastSocketCloseReason: this.lastSocketCloseReason,
      lastSocketClosedAt: this.lastSocketClosedAt,
      audioRelayState: this.audioRelay ? ("active" as const) : ("inactive" as const),
      remotePeerCount: this.remotePeerIds.size,
      roomSnapshotRevision: this.lastSnapshotRevision,
      chatSendFailures: this.chatSendFailures,
      joinStage: this.joinStage,
      wsOpened: this.wsOpened,
      joinChannelSent: this.joinChannelSent,
      joinAckReceived: this.joinAckReceived,
      roomSnapshotReceived: this.roomSnapshotReceived,
      lastServerError: this.lastServerError,
      screenShareRelayState: this.screenFrameTimer ? ("active" as const) : ("inactive" as const),
      screenShareRelayTargetCount: this.getScreenRelayTargetPeerIds().length,
      audioRelayDiagnostics: this.audioRelay?.getDiagnostics(),
      webrtcReadyPeerCount: this.webrtcReadyPeerIds.size,
      webrtcConnectedPeerCount: this.webrtcConnectedPeerIds.size,
      webrtcAudioPeerCount: this.webrtcAudioPeerIds.size,
      peerRecoveryAttempts: Object.fromEntries(this.peerRecoveryAttempts),
      peerConnectionStats: Object.fromEntries(this.peerStats),
      peerAdaptationTiers: Object.fromEntries(this.peerAdaptationTiers),
      turnConfigured: this.hasTurnServer,
    };
  }

  updateMuteState(isMuted: boolean, isSpeaking: boolean): void {
    if (this.lastPublishedMuteState === isMuted && this.lastPublishedSpeakingState === isSpeaking) {
      return;
    }

    this.lastPublishedMuteState = isMuted;
    this.lastPublishedSpeakingState = isSpeaking;
    this.audioRelay?.setMuted(isMuted);
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
    const systemAudioTrack = this.screenShareStream?.getAudioTracks()[0];
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
    this.peerVolumes.set(peerId, Math.max(0, Math.min(2, volume)));
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

    return new Promise((resolve, reject) => {
      this.clearPendingConnection();
      const timeout = window.setTimeout(() => {
        const error = new Error(this.wsOpened ? "join_ack_timeout" : "network_unreachable");
        this.rejectPendingConnection(error);
        void window.desktopApi.signaling.close(this.signalingSessionId);
      }, INITIAL_CONNECT_TIMEOUT_MS);

      this.pendingConnection = { resolve, reject, timeout };
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = window.desktopApi.signaling.onEvent((payload) => {
        if (payload.sessionId !== this.signalingSessionId) return;
        this.options.onDiagnosticEvent?.(payload);
        this.bridgeEventQueue = this.bridgeEventQueue
          .then(() => this.handleBridgeEvent(payload))
          .catch((error) => {
            this.handleBridgeFailure(error);
          });
      });

      void window.desktopApi.signaling
        .connect(this.options.signalingUrl, this.signalingSessionId)
        .catch((error) => {
          this.rejectPendingConnection(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private async handleBridgeEvent(payload: SignalingEventPayload): Promise<void> {
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
        nickname: this.nickname,
        avatarId: this.avatarId ?? "fox",
        appVersion: this.options.appVersion,
        protocolVersion: this.options.protocolVersion,
        buildNumber: this.options.buildNumber,
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
      this.lastSocketCloseCode = payload.code;
      this.lastSocketCloseReason = payload.reason;
      this.lastSocketClosedAt = new Date().toISOString();
      this.stopHeartbeat();
      this.stopSnapshotRecovery();
      this.isSignalingConnected = false;
      this.joinAckReceived = false;
      this.advertisedRelayNeeds.clear();
      this.audioRelay?.resetTransport("signaling_socket_closed");

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
        this.handleChatMessage(payload);
        return;
      case "chat_history":
        this.handleChatHistory(payload);
        return;
      case "knock_event":
        this.handleKnockEvent(payload);
        return;
      case "audio_chunk":
        this.handleAudioChunk(payload);
        return;
      case "audio_path_state":
        this.handleAudioPathState(payload);
        return;
      case "audio_resync_request":
        this.audioRelay?.handleResyncRequest(payload);
        return;
      case "audio_resync_ack":
        this.audioRelay?.handleResyncAck(payload);
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
        this.handleSceneReaction(payload);
        return;
      case "member_state":
        this.handleMemberState(payload);
        return;
      case "avatar_update":
        this.handleAvatarUpdate(payload);
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
  ): void {
    const normalizedGameName = normalizePresenceGameName(gameName);
    if (
      this.lastPublishedDeafenState === isDeafened &&
      this.lastPublishedActivity === activity &&
      this.lastPublishedSceneZone === sceneZone &&
      this.lastPublishedGameName === normalizedGameName
    ) {
      return;
    }

    this.lastPublishedDeafenState = isDeafened;
    this.lastPublishedActivity = activity;
    this.lastPublishedSceneZone = sceneZone;
    this.lastPublishedGameName = normalizedGameName;
    void this.safeSend({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isDeafened,
      activity,
      sceneZone,
      gameName: normalizedGameName,
    });
  }

  async startScreenShare(
    stream: MediaStream,
    profile: ScreenShareEncodingProfile = DEFAULT_SCREEN_SHARE_PROFILE,
  ): Promise<void> {
    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) {
      throw new Error("screen_track_missing");
    }

    if (this.screenShareStream) {
      await this.restorePrimaryInputTrack();
    }
    this.stopScreenShareTracks();
    this.screenRelayRequestedByPeerIds.clear();
    this.screenShareStream = stream;
    this.screenShareProfile = profile;
    const systemAudioTrack = stream.getAudioTracks()[0];
    if (systemAudioTrack && this.primaryInputTrack) {
      await this.applyScreenAudioMix(this.primaryInputTrack, systemAudioTrack);
    }
    this.updateScreenFrameRelaySending();
    void this.safeSend({
      type: "screen_share_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isSharing: true,
    });
    videoTrack.addEventListener(
      "ended",
      () => {
        void this.stopScreenShare(false).catch((error) => {
          void writeRendererLog("webrtc", "warn", "Failed to stop screen share after track ended", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
      { once: true },
    );

    await Promise.all(
      [...this.peers.values()].map((peer) => peer.setScreenTrack(videoTrack, profile)),
    );
    void writeRendererLog("webrtc", "info", "Screen share track attached", {
      peerCount: this.peers.size,
      trackId: videoTrack.id,
      settings: videoTrack.getSettings?.(),
      profile,
    });
  }

  async stopScreenShare(stopTracks = true): Promise<void> {
    const previousStream = this.screenShareStream;
    this.screenShareStream = undefined;
    this.screenRelayRequestedByPeerIds.clear();
    this.stopScreenFrameRelay();

    await Promise.all([...this.peers.values()].map((peer) => peer.setScreenTrack(undefined)));
    await this.restorePrimaryInputTrack();
    if (stopTracks) {
      previousStream?.getTracks().forEach((track) => track.stop());
    }
    void this.safeSend({
      type: "screen_share_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isSharing: false,
    });
    void writeRendererLog("webrtc", "info", "Screen share track detached", {
      peerCount: this.peers.size,
    });
  }

  private handleJoinAck(payload: JoinAckMessage): void {
    if (payload.roomId !== this.options.roomId || payload.peerId !== this.options.peerId) {
      return;
    }

    this.joinAckReceived = true;
    this.hasJoinedOnce = true;
    this.joinStage = "join_ack_received";
    this.options.onConnectionState(RoomConnectionState.WaitingSnapshot);
    this.resolvePendingConnection();
    this.startSnapshotRecovery();
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
    const normalizedMembers = snapshot.members.map((member) => ({
      ...member,
      avatarDataUrl: this.avatarCache.get(member.id)?.avatarDataUrl,
      presenceState:
        member.id === this.options.peerId || member.presenceState === MemberPresenceState.Online
          ? MemberPresenceState.Online
          : member.presenceState,
      speakingState: member.isMuted
        ? MemberSpeakingState.Muted
        : (member.speakingState ?? MemberSpeakingState.Silent),
    }));

    this.currentMembers = normalizedMembers;
    this.options.onMembers(normalizedMembers);
    this.options.onConnectionState(
      normalizedMembers.filter((member) => !member.isEmptySlot).length <= 1
        ? RoomConnectionState.WaitingPeer
        : RoomConnectionState.Connected,
    );
    this.backoff.reset();
    this.reconnectAttempts = 0;
    this.hasJoinedOnce = true;
    this.joinAckReceived = true;
    this.resolvePendingConnection();

    const activePeerIds = new Set(
      normalizedMembers
        .filter((member) => member.id !== this.options.peerId)
        .map((member) => member.id),
    );
    this.remotePeerIds.clear();
    activePeerIds.forEach((peerId) => this.remotePeerIds.add(peerId));
    for (const peerId of [...this.relayRequestedByPeerIds]) {
      if (!activePeerIds.has(peerId)) this.relayRequestedByPeerIds.delete(peerId);
    }
    for (const peerId of [...this.advertisedRelayNeeds.keys()]) {
      if (!activePeerIds.has(peerId)) this.advertisedRelayNeeds.delete(peerId);
    }
    for (const peerId of [...this.remoteSharingPeerIds]) {
      if (!activePeerIds.has(peerId)) this.remoteSharingPeerIds.delete(peerId);
    }
    for (const peerId of [...this.screenRelayRequestedByPeerIds]) {
      if (!activePeerIds.has(peerId)) this.screenRelayRequestedByPeerIds.delete(peerId);
    }
    for (const peerId of [...this.advertisedScreenRelayNeeds.keys()]) {
      if (!activePeerIds.has(peerId)) this.advertisedScreenRelayNeeds.delete(peerId);
    }
    this.startAudioRelay();
    this.updateAudioRelaySending();
    for (const peerId of activePeerIds) {
      this.advertiseAudioPathState(peerId, !this.webrtcReadyPeerIds.has(peerId), "snapshot_sync");
    }

    for (const peerId of [...this.peers.keys()]) {
      if (!activePeerIds.has(peerId)) {
        const peer = this.peers.get(peerId);
        this.peers.delete(peerId);
        this.peerStats.delete(peerId);
        this.peerAudioProgress.delete(peerId);
        this.peerConnectedAt.delete(peerId);
        this.peerAdaptationTiers.delete(peerId);
        this.clearPeerRecovery(peerId, true);
        peer?.destroy();
        this.webrtcConnectedPeerIds.delete(peerId);
        this.webrtcAudioPeerIds.delete(peerId);
        this.webrtcReadyPeerIds.delete(peerId);
        this.webrtcStalledPeerIds.delete(peerId);
        this.webrtcScreenPeerIds.delete(peerId);
        this.pendingIceCandidates.delete(peerId);
        this.relayRequestedByPeerIds.delete(peerId);
        this.advertisedRelayNeeds.delete(peerId);
        this.remoteSharingPeerIds.delete(peerId);
        this.screenRelayRequestedByPeerIds.delete(peerId);
        this.advertisedScreenRelayNeeds.delete(peerId);
        this.audioRelay?.clearPeer(peerId, "peer_left_room");
        this.options.onRemoteStream(peerId, undefined);
        this.options.onRemoteScreenFrame(peerId, undefined);
      }
    }

    for (const member of normalizedMembers) {
      if (member.id === this.options.peerId || this.peers.has(member.id)) {
        continue;
      }

      if (this.options.peerId < member.id) {
        const peer = this.createPeer(member.id);
        await this.applyScreenShareToPeer(peer);
        const offer = await peer.createOffer();
        await this.send({
          type: "peer_offer",
          roomId: this.options.roomId,
          peerId: this.options.peerId,
          targetPeerId: member.id,
          sdp: offer,
        });
      }
    }
  }

  private async handlePeerOffer(payload: PeerOfferMessage): Promise<void> {
    const existing = this.peers.get(payload.peerId);
    const peer =
      existing && existing.connection.connectionState === "connected"
        ? existing
        : this.replacePeer(payload.peerId);
    await this.applyScreenShareToPeer(peer);
    const answer = await peer.acceptOffer(payload.sdp);

    await this.send({
      type: "peer_answer",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId: payload.peerId,
      sdp: answer,
    });
  }

  private async handlePeerAnswer(payload: PeerAnswerMessage): Promise<void> {
    const peer = this.peers.get(payload.peerId);
    if (!peer) {
      return;
    }

    await peer.acceptAnswer(payload.sdp);
  }

  private async handlePeerRestartRequest(payload: PeerRestartRequestMessage): Promise<void> {
    if (payload.targetPeerId !== this.options.peerId || !this.remotePeerIds.has(payload.peerId)) {
      return;
    }
    void writeRendererLog("webrtc", "warn", "Peer requested a fresh media negotiation", {
      targetPeerId: payload.peerId,
      reason: payload.reason,
    });
    const peer = this.replacePeer(payload.peerId);
    if (this.options.peerId < payload.peerId) {
      await this.sendFreshOffer(payload.peerId, peer, `remote_request:${payload.reason}`);
    }
  }

  private async handleIceCandidate(payload: IceCandidateMessage): Promise<void> {
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
  }

  private handleErrorMessage(payload: ErrorMessage): void {
    this.lastServerError = `${payload.code}:${payload.message}`;
    this.options.onConnectionState(RoomConnectionState.Failed);
    const isProtocolRejected =
      payload.code === "4400" ||
      payload.code === "invalid_message" ||
      payload.code === "unsupported_protocol";
    const error = new Error(
      isProtocolRejected ? "signaling_protocol_rejected" : payload.message || payload.code,
    );
    if (isProtocolRejected) this.shouldReconnect = false;
    this.rejectPendingConnection(error);
  }

  async sendChatMessage(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("empty_chat_message");
    }

    if (!this.canSendChat()) {
      throw new Error("signaling_not_connected");
    }

    try {
      await this.send({
        type: "chat_message",
        roomId: this.options.roomId,
        content: trimmed,
      });
    } catch (error) {
      this.chatSendFailures += 1;
      throw error;
    }
  }

  async sendKnock(): Promise<void> {
    if (!this.canSendChat()) {
      throw new Error("signaling_not_connected");
    }

    await this.send({
      type: "knock_event",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      nickname: this.nickname,
      createdAt: new Date().toISOString(),
    });
  }

  async sendSceneReaction(targetPeerId: string, emoji: SceneReaction["emoji"]): Promise<void> {
    if (!this.canSendChat()) {
      throw new Error("signaling_not_connected");
    }
    await this.send({
      type: "scene_reaction",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId,
      emoji,
      createdAt: new Date().toISOString(),
    });
  }

  private handleChatMessage(payload: SignalChatMessage): void {
    if (!payload.id || !payload.peerId || !payload.nickname || !payload.createdAt) return;
    this.options.onChatMessage({
      id: payload.id,
      peerId: payload.peerId,
      nickname: payload.nickname,
      avatarDataUrl: payload.avatarDataUrl,
      avatarId: payload.avatarId,
      content: payload.content,
      createdAt: payload.createdAt,
      isLocal: payload.peerId === this.options.peerId,
    });
  }

  private handleChatHistory(payload: ChatHistoryMessage): void {
    this.options.onChatHistory(
      payload.messages.map((message) => ({
        ...message,
        isLocal: message.peerId === this.options.peerId,
        kind: "chat" as const,
      })),
    );
  }

  private handleKnockEvent(payload: KnockEventMessage): void {
    this.options.onKnock({
      id: `knock-${payload.peerId}-${payload.createdAt}`,
      peerId: payload.peerId,
      nickname: payload.nickname,
      content:
        payload.peerId === this.options.peerId ? "你敲了一下" : `${payload.nickname} 敲了一下`,
      createdAt: payload.createdAt,
      isLocal: payload.peerId === this.options.peerId,
      kind: "system",
    });
  }

  private handleAudioChunk(payload: AudioChunkMessage): void {
    if (payload.targetPeerIds && !payload.targetPeerIds.includes(this.options.peerId)) {
      return;
    }
    this.audioRelay?.handleRemoteChunk(payload);
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
    if (payload.peerId === this.options.peerId) {
      return;
    }
    if (payload.targetPeerIds && !payload.targetPeerIds.includes(this.options.peerId)) {
      return;
    }

    this.options.onRemoteScreenFrame(payload.peerId, {
      data: payload.data,
      width: payload.width,
      height: payload.height,
      sequence: payload.sequence,
      receivedAt: new Date().toISOString(),
    });
  }

  private handleScreenShareState(payload: ScreenShareStateMessage): void {
    if (payload.peerId === this.options.peerId) {
      return;
    }

    if (payload.isSharing) {
      this.remoteSharingPeerIds.add(payload.peerId);
      this.advertiseScreenPathState(
        payload.peerId,
        !this.webrtcScreenPeerIds.has(payload.peerId),
        "screen_share_started",
      );
      return;
    }

    this.remoteSharingPeerIds.delete(payload.peerId);
    this.webrtcScreenPeerIds.delete(payload.peerId);
    this.advertiseScreenPathState(payload.peerId, false, "screen_share_stopped");
    this.options.onRemoteScreenFrame(payload.peerId, undefined);
  }

  private handleScreenPathState(payload: ScreenPathStateMessage): void {
    if (payload.targetPeerId !== this.options.peerId || !this.remotePeerIds.has(payload.peerId)) {
      return;
    }
    if (payload.needsRelay) {
      this.screenRelayRequestedByPeerIds.add(payload.peerId);
    } else {
      this.screenRelayRequestedByPeerIds.delete(payload.peerId);
    }
    this.updateScreenFrameRelaySending();
    void writeRendererLog("webrtc", "info", "Remote peer screen path request updated", {
      peerId: payload.peerId,
      needsRelay: payload.needsRelay,
      reason: payload.reason,
      activeScreenRelayRequests: this.screenRelayRequestedByPeerIds.size,
    });
  }

  private handleSceneReaction(payload: SceneReactionMessage): void {
    this.options.onSceneReaction({
      id: `${payload.peerId}-${payload.targetPeerId}-${payload.createdAt}`,
      peerId: payload.peerId,
      targetPeerId: payload.targetPeerId,
      emoji: payload.emoji,
      createdAt: payload.createdAt,
    });
  }

  private handleMemberState(payload: MemberStateMessage): void {
    let changed = false;
    this.currentMembers = this.currentMembers.map((member) => {
      if (member.id !== payload.peerId) {
        return member;
      }
      changed = true;
      const isMuted = payload.isMuted ?? member.isMuted;
      const isSpeaking =
        payload.isSpeaking ?? member.speakingState === MemberSpeakingState.Speaking;
      return {
        ...member,
        nickname: payload.nickname ?? member.nickname,
        avatarId: payload.avatarId ?? member.avatarId,
        isDeafened: payload.isDeafened ?? member.isDeafened,
        activity: payload.activity ?? member.activity,
        sceneZone: payload.sceneZone ?? member.sceneZone,
        gameName: payload.gameName === "" ? undefined : (payload.gameName ?? member.gameName),
        isMuted,
        speakingState: isMuted
          ? MemberSpeakingState.Muted
          : isSpeaking
            ? MemberSpeakingState.Speaking
            : MemberSpeakingState.Silent,
      };
    });
    if (changed) {
      this.options.onMembers(this.currentMembers);
    }
  }

  private handleAvatarUpdate(payload: AvatarUpdateMessage): void {
    if (!payload.avatarDataUrl) {
      return;
    }
    this.avatarCache.set(payload.peerId, {
      avatarHash: payload.avatarHash,
      avatarDataUrl: payload.avatarDataUrl,
    });
    let changed = false;
    this.currentMembers = this.currentMembers.map((member) => {
      if (member.id !== payload.peerId) {
        return member;
      }
      changed = true;
      return {
        ...member,
        avatarHash: payload.avatarHash,
        avatarDataUrl: payload.avatarDataUrl,
      };
    });
    if (changed) {
      this.options.onMembers(this.currentMembers);
    }
  }

  private startAudioRelay(): void {
    if (this.audioRelay) {
      return;
    }

    this.audioRelay = new SignalingAudioRelay({
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      localStream: this.localStream,
      send: (message) => this.send(message),
      shouldPlayPeer: (peerId) => !this.webrtcReadyPeerIds.has(peerId),
      getTargetPeerIds: () => this.getAudioRelayTargetPeerIds(),
      getPeerVolume: (peerId) => this.peerVolumes.get(peerId) ?? 1,
      onLog: (level, message, context) => {
        void writeRendererLog("audio", level, message, context);
      },
    });
    this.audioRelay.setMuted(this.lastPublishedMuteState ?? false);
    void this.audioRelay.start().catch((error) => {
      void writeRendererLog("audio", "warn", "Failed to start signaling audio relay", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private updateAudioRelaySending(): void {
    this.audioRelay?.setShouldSend(this.getAudioRelayTargetPeerIds().length > 0);
    this.updateScreenFrameRelaySending();
  }

  private getAudioRelayTargetPeerIds(): string[] {
    return [...this.remotePeerIds].filter(
      (peerId) => !this.webrtcReadyPeerIds.has(peerId) || this.relayRequestedByPeerIds.has(peerId),
    );
  }

  private updateScreenFrameRelaySending(): void {
    const targetPeerIds = this.getScreenRelayTargetPeerIds();
    if (
      this.screenShareStream &&
      targetPeerIds.length > 0 &&
      (!this.screenFrameTimer || this.screenFrameIntervalMs !== SCREEN_FRAME_INTERVAL_MS)
    ) {
      this.startScreenFrameRelay(this.screenShareStream, SCREEN_FRAME_INTERVAL_MS);
      return;
    }
    if ((!this.screenShareStream || targetPeerIds.length === 0) && this.screenFrameTimer) {
      this.stopScreenFrameRelay();
    }
  }

  private getScreenRelayTargetPeerIds(): string[] {
    return [...this.remotePeerIds].filter(
      (peerId) =>
        !this.webrtcReadyPeerIds.has(peerId) || this.screenRelayRequestedByPeerIds.has(peerId),
    );
  }

  private createPeer(targetPeerId: string): MeshPeerConnection {
    const peer = new MeshPeerConnection({
      peerId: targetPeerId,
      localStream: this.localStream,
      iceServers: this.iceServers,
      onRemoteStream: (stream) => {
        const hasPlayableAudio = hasPlayableAudioTrack(stream);
        const hasLiveScreen = stream
          .getVideoTracks()
          .some((track) => track.readyState === "live" && track.enabled);
        if (hasPlayableAudio) {
          this.webrtcAudioPeerIds.add(targetPeerId);
        } else {
          this.webrtcAudioPeerIds.delete(targetPeerId);
        }
        if (hasLiveScreen) {
          this.webrtcScreenPeerIds.add(targetPeerId);
        } else {
          this.webrtcScreenPeerIds.delete(targetPeerId);
        }
        if (this.remoteSharingPeerIds.has(targetPeerId)) {
          this.advertiseScreenPathState(
            targetPeerId,
            !hasLiveScreen,
            hasLiveScreen ? "webrtc_screen_track_ready" : "webrtc_screen_track_unavailable",
          );
        }
        this.syncPeerMediaPath(
          targetPeerId,
          hasPlayableAudio ? "remote_audio_track_playable" : "remote_audio_track_unavailable",
        );
        this.options.onRemoteStream(targetPeerId, stream);
      },
      onIceCandidate: (candidate) => {
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
          this.peerConnectedAt.set(targetPeerId, Date.now());
          this.peerAudioProgress.delete(targetPeerId);
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
          this.webrtcReadyPeerIds.delete(targetPeerId);
          this.webrtcStalledPeerIds.delete(targetPeerId);
          this.webrtcScreenPeerIds.delete(targetPeerId);
          this.peerAudioProgress.delete(targetPeerId);
          this.peerConnectedAt.delete(targetPeerId);
          this.audioRelay?.markPeerPath(targetPeerId, "relay", `webrtc_${state}`);
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
            this.schedulePeerRecovery(targetPeerId, `connection_${state}`);
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
    const watchdog = window.setTimeout(() => {
      this.peerConnectionWatchdogs.delete(targetPeerId);
      if (
        this.peers.get(targetPeerId) === peer &&
        !this.webrtcReadyPeerIds.has(targetPeerId) &&
        this.remotePeerIds.has(targetPeerId)
      ) {
        this.schedulePeerRecovery(targetPeerId, "connection_timeout");
      }
    }, 8_000);
    this.peerConnectionWatchdogs.set(targetPeerId, watchdog);
    return peer;
  }

  private replacePeer(targetPeerId: string): MeshPeerConnection {
    const existing = this.peers.get(targetPeerId);
    if (existing) {
      this.peers.delete(targetPeerId);
      existing.destroy();
    }
    this.peerStats.delete(targetPeerId);
    this.peerAudioProgress.delete(targetPeerId);
    this.peerConnectedAt.delete(targetPeerId);
    this.peerAdaptationTiers.delete(targetPeerId);
    this.clearPeerRecovery(targetPeerId);
    this.webrtcConnectedPeerIds.delete(targetPeerId);
    this.webrtcAudioPeerIds.delete(targetPeerId);
    this.webrtcReadyPeerIds.delete(targetPeerId);
    this.webrtcStalledPeerIds.delete(targetPeerId);
    this.webrtcScreenPeerIds.delete(targetPeerId);
    this.options.onRemoteStream(targetPeerId, undefined);
    return this.createPeer(targetPeerId);
  }

  private schedulePeerRecovery(targetPeerId: string, reason: string): void {
    if (
      this.peerRecoveryTimers.has(targetPeerId) ||
      !this.shouldReconnect ||
      !this.isSignalingConnected ||
      !this.remotePeerIds.has(targetPeerId)
    ) {
      return;
    }
    const attempt = (this.peerRecoveryAttempts.get(targetPeerId) ?? 0) + 1;
    this.peerRecoveryAttempts.set(targetPeerId, attempt);
    const baseDelay = Math.min(15_000, 1_500 * 2 ** Math.min(3, attempt - 1));
    const delay = baseDelay + Math.floor(Math.random() * 450);
    void writeRendererLog("webrtc", "warn", "Scheduling peer media recovery", {
      targetPeerId,
      attempt,
      delay,
      reason,
    });
    const timer = window.setTimeout(() => {
      this.peerRecoveryTimers.delete(targetPeerId);
      void this.recoverPeer(targetPeerId, reason).catch((error) => {
        void writeRendererLog("webrtc", "warn", "Peer media recovery failed", {
          targetPeerId,
          attempt,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        this.schedulePeerRecovery(targetPeerId, "recovery_failed");
      });
    }, delay);
    this.peerRecoveryTimers.set(targetPeerId, timer);
  }

  private syncPeerMediaPath(targetPeerId: string, reason: string): void {
    const isReady =
      this.webrtcConnectedPeerIds.has(targetPeerId) &&
      this.webrtcAudioPeerIds.has(targetPeerId) &&
      !this.webrtcStalledPeerIds.has(targetPeerId);
    const wasReady = this.webrtcReadyPeerIds.has(targetPeerId);

    if (isReady) {
      this.webrtcReadyPeerIds.add(targetPeerId);
      this.advertiseAudioPathState(targetPeerId, false, reason);
      this.clearPeerRecovery(targetPeerId, true);
      if (!wasReady) {
        this.audioRelay?.markPeerPath(targetPeerId, "webrtc", reason);
        void writeRendererLog("webrtc", "info", "Remote audio track is playable", {
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
      this.audioRelay?.markPeerPath(targetPeerId, "relay", reason);
      this.updateAudioRelaySending();
      if (this.isSignalingConnected && this.remotePeerIds.has(targetPeerId)) {
        this.options.onConnectionState(RoomConnectionState.Degraded);
        this.schedulePeerRecovery(targetPeerId, "remote_audio_unavailable");
      }
      void writeRendererLog("webrtc", "warn", "Remote audio track became unavailable", {
        targetPeerId,
        reason,
        audioRelayFallbackEnabled: true,
      });
    }
  }

  private advertiseAudioPathState(targetPeerId: string, needsRelay: boolean, reason: string): void {
    if (!this.isSignalingConnected || !this.remotePeerIds.has(targetPeerId)) return;
    if (this.advertisedRelayNeeds.get(targetPeerId) === needsRelay) return;
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

  private advertiseScreenPathState(
    targetPeerId: string,
    needsRelay: boolean,
    reason: string,
  ): void {
    if (!this.isSignalingConnected || !this.remotePeerIds.has(targetPeerId)) return;
    if (this.advertisedScreenRelayNeeds.get(targetPeerId) === needsRelay) return;
    this.advertisedScreenRelayNeeds.set(targetPeerId, needsRelay);
    void this.safeSend({
      type: "screen_path_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId,
      needsRelay,
      reason,
    }).catch(() => {
      this.advertisedScreenRelayNeeds.delete(targetPeerId);
    });
  }

  private async recoverPeer(targetPeerId: string, reason: string): Promise<void> {
    if (!this.isSignalingConnected || !this.remotePeerIds.has(targetPeerId)) {
      return;
    }
    const peer = this.replacePeer(targetPeerId);
    if (this.options.peerId < targetPeerId) {
      await this.sendFreshOffer(targetPeerId, peer, reason);
      return;
    }
    await this.send({
      type: "peer_restart_request",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId,
      reason,
    });
  }

  private async sendFreshOffer(
    targetPeerId: string,
    peer: MeshPeerConnection,
    reason: string,
  ): Promise<void> {
    await this.applyScreenShareToPeer(peer);
    const offer = await peer.createOffer();
    await this.send({
      type: "peer_offer",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId,
      sdp: offer,
    });
    void writeRendererLog("webrtc", "info", "Fresh peer media offer sent", {
      targetPeerId,
      reason,
    });
  }

  private clearPeerRecovery(peerId: string, resetAttempts = false): void {
    const recoveryTimer = this.peerRecoveryTimers.get(peerId);
    if (recoveryTimer) window.clearTimeout(recoveryTimer);
    this.peerRecoveryTimers.delete(peerId);
    const watchdog = this.peerConnectionWatchdogs.get(peerId);
    if (watchdog) window.clearTimeout(watchdog);
    this.peerConnectionWatchdogs.delete(peerId);
    if (resetAttempts) this.peerRecoveryAttempts.delete(peerId);
  }

  private async applyScreenShareToPeer(peer: MeshPeerConnection): Promise<void> {
    const [videoTrack] = this.screenShareStream?.getVideoTracks() ?? [];
    if (!videoTrack || videoTrack.readyState !== "live") {
      return;
    }

    await peer.setScreenTrack(videoTrack, this.screenShareProfile);
  }

  private async send(payload: SignalEnvelope): Promise<void> {
    if (!this.isSignalingConnected) {
      throw new Error("signaling_not_connected");
    }
    await window.desktopApi.signaling.send(JSON.stringify(payload), this.signalingSessionId);
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
    void window.desktopApi.signaling.close(this.signalingSessionId).catch(() => undefined);
  }

  private async safeSend(payload: SignalEnvelope): Promise<boolean> {
    if (!this.isSignalingConnected) {
      return false;
    }

    try {
      await this.send(payload);
      return true;
    } catch (error) {
      void writeRendererLog("signaling", "warn", "Skipped signaling send", {
        type: payload.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
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

  private startPeerStats(): void {
    this.stopPeerStats();
    const collect = async () => {
      await Promise.all(
        [...this.peers.entries()].map(async ([peerId, peer]) => {
          try {
            const stats = await collectPeerAudioStats(peer.connection);
            this.monitorPeerAudioFlow(peerId, stats);
            this.peerStats.set(peerId, stats);
            this.options.onPeerLatency?.(peerId, stats.roundTripTimeMs);
            const previousTier = this.peerAdaptationTiers.get(peerId);
            const nextTier = await peer.adaptToNetwork(stats);
            this.peerAdaptationTiers.set(peerId, nextTier);
            if (previousTier && previousTier !== nextTier) {
              void writeRendererLog("webrtc", "info", "Peer network adaptation changed", {
                peerId,
                previousTier,
                nextTier,
                packetLossPercent: stats.packetLossPercent,
                jitterMs: stats.jitterMs,
                roundTripTimeMs: stats.roundTripTimeMs,
                availableOutgoingBitrateBps: stats.availableOutgoingBitrateBps,
              });
            }
          } catch {
            this.peerStats.delete(peerId);
            this.peerAdaptationTiers.delete(peerId);
            this.options.onPeerLatency?.(peerId, undefined);
          }
        }),
      );
      this.options.onPeerStats?.(Object.fromEntries(this.peerStats));
    };
    void collect();
    this.peerStatsTimer = window.setInterval(() => void collect(), PEER_AUDIO_HEALTH_INTERVAL_MS);
  }

  private monitorPeerAudioFlow(peerId: string, stats: PeerAudioStats): void {
    if (
      !this.remotePeerIds.has(peerId) ||
      !this.webrtcConnectedPeerIds.has(peerId) ||
      !this.webrtcAudioPeerIds.has(peerId)
    ) {
      return;
    }

    const nowMs = Date.now();
    const connectedAtMs = this.peerConnectedAt.get(peerId) ?? nowMs;
    this.peerConnectedAt.set(peerId, connectedAtMs);
    const isRemoteMuted =
      this.currentMembers.find((member) => member.id === peerId)?.isMuted ?? false;
    const evaluation = evaluateInboundAudioFlow(stats, this.peerAudioProgress.get(peerId), {
      nowMs,
      connectedAtMs,
      isRemoteMuted,
    });
    stats.inboundAudioFlow = evaluation.status;
    this.peerAudioProgress.set(peerId, evaluation.next);

    const wasStalled = this.webrtcStalledPeerIds.has(peerId);
    if (evaluation.status === "stalled") {
      this.webrtcStalledPeerIds.add(peerId);
      this.syncPeerMediaPath(peerId, "inbound_rtp_stalled");
      if (!wasStalled) {
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
        this.schedulePeerRecovery(peerId, "inbound_rtp_stalled");
      }
      return;
    }

    if (wasStalled && (evaluation.status === "flowing" || evaluation.status === "muted")) {
      this.webrtcStalledPeerIds.delete(peerId);
      this.syncPeerMediaPath(
        peerId,
        evaluation.status === "muted" ? "remote_muted" : "inbound_rtp_resumed",
      );
      void writeRendererLog("webrtc", "info", "Remote audio RTP resumed", {
        peerId,
        status: evaluation.status,
        packetsReceived: stats.packetsReceived,
        bytesReceived: stats.bytesReceived,
      });
    }
  }

  private stopPeerStats(): void {
    if (this.peerStatsTimer) {
      window.clearInterval(this.peerStatsTimer);
      this.peerStatsTimer = undefined;
    }
    this.peerStats.clear();
    this.peerAudioProgress.clear();
    this.peerAdaptationTiers.clear();
  }

  private handlePong(payload: PongMessage): void {
    const rttMs = Math.max(0, Date.now() - payload.sentAt);
    const midpoint = payload.sentAt + rttMs / 2;
    const serverClockOffsetMs = payload.serverTime - midpoint;
    this.audioRelay?.setServerClockOffsetMs(serverClockOffsetMs);
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
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts += 1;
    this.options.onReconnectAttempt?.(this.reconnectAttempts);
    const baseDelay = this.backoff.nextDelay();
    const delay = baseDelay + Math.floor(Math.random() * Math.max(250, baseDelay * 0.16));
    void writeRendererLog("signaling", "warn", "Scheduling signaling reconnect", {
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      attempt: this.reconnectAttempts,
      delay,
    });
    this.reconnectTimer = window.setTimeout(() => {
      void this.openSocket(true).catch((error) => {
        void writeRendererLog("signaling", "warn", "Signaling reconnect attempt failed", {
          roomId: this.options.roomId,
          peerId: this.options.peerId,
          attempt: this.reconnectAttempts,
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.shouldReconnect) {
          this.reconnect();
        }
      });
    }, delay);
  }

  private clearPeers(): void {
    const existingPeers = [...this.peers];
    this.peers.clear();
    for (const [peerId, peer] of existingPeers) {
      this.clearPeerRecovery(peerId, true);
      peer.destroy();
      this.options.onRemoteStream(peerId, undefined);
      this.options.onRemoteScreenFrame(peerId, undefined);
    }
    this.peerStats.clear();
    this.peerAdaptationTiers.clear();
    this.webrtcConnectedPeerIds.clear();
    this.webrtcAudioPeerIds.clear();
    this.webrtcReadyPeerIds.clear();
    this.webrtcStalledPeerIds.clear();
    this.webrtcScreenPeerIds.clear();
    this.peerAudioProgress.clear();
    this.peerConnectedAt.clear();
    this.pendingIceCandidates.clear();
    this.relayRequestedByPeerIds.clear();
    this.advertisedRelayNeeds.clear();
    this.remoteSharingPeerIds.clear();
    this.screenRelayRequestedByPeerIds.clear();
    this.advertisedScreenRelayNeeds.clear();
    this.remotePeerIds.clear();
    this.updateAudioRelaySending();
  }

  private async applyOutgoingAudioTrack(track: MediaStreamTrack): Promise<void> {
    const nextStream = new MediaStream([track]);
    this.localStream = nextStream;
    await Promise.all([...this.peers.values()].map((peer) => peer.replaceLocalTrack(track)));
    await this.audioRelay?.replaceLocalStream(nextStream);
  }

  private async applyScreenAudioMix(
    microphoneTrack: MediaStreamTrack,
    systemAudioTrack: MediaStreamTrack,
  ): Promise<void> {
    this.disposeScreenAudioMixer();
    let context: AudioContext;
    try {
      context = new AudioContext({ latencyHint: "interactive", sampleRate: 32_000 });
    } catch {
      context = new AudioContext({ latencyHint: "interactive" });
    }
    const destination = context.createMediaStreamDestination();
    const microphoneSource = context.createMediaStreamSource(new MediaStream([microphoneTrack]));
    const systemSource = context.createMediaStreamSource(new MediaStream([systemAudioTrack]));
    const microphoneGain = context.createGain();
    const systemGain = context.createGain();
    microphoneGain.gain.value = 1;
    systemGain.gain.value = 0.72;
    microphoneSource.connect(microphoneGain).connect(destination);
    systemSource.connect(systemGain).connect(destination);
    const mixedTrack = destination.stream.getAudioTracks()[0];
    if (!mixedTrack) {
      await context.close();
      return;
    }
    mixedTrack.contentHint = "speech";
    this.screenAudioContext = context;
    this.mixedScreenAudioTrack = mixedTrack;
    await this.applyOutgoingAudioTrack(mixedTrack);
    void writeRendererLog("audio", "info", "Screen system audio mixed with microphone", {
      contextSampleRate: context.sampleRate,
      systemTrackLabel: systemAudioTrack.label,
    });
  }

  private async restorePrimaryInputTrack(): Promise<void> {
    const primaryTrack = this.primaryInputTrack;
    if (primaryTrack?.readyState === "live" && this.mixedScreenAudioTrack) {
      await this.applyOutgoingAudioTrack(primaryTrack);
    }
    this.disposeScreenAudioMixer();
  }

  private disposeScreenAudioMixer(): void {
    this.mixedScreenAudioTrack?.stop();
    this.mixedScreenAudioTrack = undefined;
    if (this.screenAudioContext) {
      void this.screenAudioContext.close().catch(() => undefined);
      this.screenAudioContext = undefined;
    }
  }

  private stopScreenShareTracks(): void {
    this.stopScreenFrameRelay();
    this.disposeScreenAudioMixer();
    this.screenShareStream?.getTracks().forEach((track) => track.stop());
    this.screenShareStream = undefined;
  }

  private startScreenFrameRelay(stream: MediaStream, intervalMs: number): void {
    this.stopScreenFrameRelay();

    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) {
      return;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const canvas = document.createElement("canvas");
    this.screenFrameVideo = video;
    this.screenFrameCanvas = canvas;
    this.screenFrameIntervalMs = intervalMs;
    video.addEventListener("loadeddata", () => void this.captureAndSendScreenFrame(), {
      once: true,
    });
    void video.play().catch(() => undefined);
    this.screenFrameTimer = window.setInterval(
      () => void this.captureAndSendScreenFrame(),
      intervalMs,
    );
    void this.captureAndSendScreenFrame();
  }

  private stopScreenFrameRelay(): void {
    if (this.screenFrameTimer) {
      window.clearInterval(this.screenFrameTimer);
      this.screenFrameTimer = undefined;
    }
    this.screenFrameIntervalMs = undefined;

    if (this.screenFrameVideo) {
      this.screenFrameVideo.pause();
      this.screenFrameVideo.srcObject = null;
      this.screenFrameVideo = undefined;
    }
    this.screenFrameCanvas = undefined;
  }

  private async captureAndSendScreenFrame(): Promise<void> {
    const video = this.screenFrameVideo;
    const canvas = this.screenFrameCanvas;
    const targetPeerIds = this.getScreenRelayTargetPeerIds();
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    if (targetPeerIds.length === 0) {
      this.stopScreenFrameRelay();
      return;
    }

    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    let width = Math.min(SCREEN_FRAME_MAX_WIDTH, sourceWidth);
    let height = Math.max(1, Math.round((width / sourceWidth) * sourceHeight));
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    let data = canvas.toDataURL("image/jpeg", 0.38);
    if (new TextEncoder().encode(data).byteLength > SCREEN_FRAME_MAX_BYTES) {
      width = Math.min(480, sourceWidth);
      height = Math.max(1, Math.round((width / sourceWidth) * sourceHeight));
      canvas.width = width;
      canvas.height = height;
      const retryContext = canvas.getContext("2d", { alpha: false });
      retryContext?.drawImage(video, 0, 0, width, height);
      data = canvas.toDataURL("image/jpeg", 0.26);
      if (new TextEncoder().encode(data).byteLength > SCREEN_FRAME_MAX_BYTES) {
        return;
      }
    }

    await this.safeSend({
      type: "screen_frame",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      sourcePeerId: this.options.peerId,
      sequence: ++this.screenFrameSequence,
      sentAt: Date.now(),
      width,
      height,
      data,
      targetPeerIds,
    });
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
