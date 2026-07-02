import {
  DEFAULT_RECONNECT_DELAYS_MS,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  type BuiltInAvatarId,
  type ChatMessage,
  type MemberActivity,
  type RoomMember,
  type RoomNote,
  type SceneReaction,
  type SceneZoneId,
  type SignalingEventPayload,
} from "@private-voice/shared";
import type {
  AudioChunkMessage,
  AvatarUpdateMessage,
  ChatMessage as SignalChatMessage,
  ErrorMessage,
  IceCandidateMessage,
  JoinAckMessage,
  KnockEventMessage,
  PongMessage,
  MemberStateMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  RoomSnapshotMessage,
  ChannelSnapshotMessage,
  ScreenFrameMessage,
  ScreenShareStateMessage,
  SceneReactionMessage,
  RoomNoteUpdateMessage,
  SignalEnvelope,
} from "@private-voice/signaling";
import {
  DEFAULT_SCREEN_SHARE_PROFILE,
  ExponentialBackoff,
  MeshPeerConnection,
  type ScreenShareEncodingProfile,
} from "@private-voice/webrtc";

import { writeRendererLog } from "../../utils/logger";
import { SignalingAudioRelay } from "./signalingAudioRelay";

interface RoomClientOptions {
  signalingUrl: string;
  roomId: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  customStatus?: string;
  localStream: MediaStream;
  appVersion: string;
  protocolVersion: string;
  buildNumber: string;
  onMembers: (members: RoomMember[]) => void;
  onRoomName: (roomName: string) => void;
  onConnectionState: (state: RoomConnectionState) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | undefined) => void;
  onChatMessage: (message: ChatMessage) => void;
  onKnock: (message: ChatMessage) => void;
  onRemoteScreenFrame: (peerId: string, frame?: RemoteScreenFrame) => void;
  onRoomNote: (note?: RoomNote) => void;
  onSceneReaction: (reaction: SceneReaction) => void;
  onDiagnosticEvent?: (payload: SignalingEventPayload) => void;
  onReconnectAttempt?: (attempt: number) => void;
  onReconnectExhausted?: (error: Error) => void;
  onSnapshotRevision?: (revision: number) => void;
  onRtt?: (rttMs: number) => void;
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
const MAX_RECONNECT_ATTEMPTS = 6;
const SCREEN_FRAME_INTERVAL_MS = 2_000;
const SCREEN_FRAME_HEALTHY_INTERVAL_MS = 5_000;
const SCREEN_FRAME_MAX_WIDTH = 512;
const SCREEN_FRAME_MAX_BYTES = 64 * 1024;

export class RoomClient {
  private readonly backoff = new ExponentialBackoff(DEFAULT_RECONNECT_DELAYS_MS);
  private readonly peers = new Map<string, MeshPeerConnection>();
  private heartbeatTimer?: number;
  private snapshotRetryTimer?: number;
  private reconnectTimer?: number;
  private shouldReconnect = true;
  private localStream: MediaStream;
  private nickname: string;
  private avatarDataUrl?: string;
  private avatarId?: BuiltInAvatarId;
  private customStatus?: string;
  private lastPublishedMuteState?: boolean;
  private lastPublishedSpeakingState?: boolean;
  private lastPublishedDeafenState?: boolean;
  private lastPublishedActivity?: MemberActivity;
  private lastPublishedSceneZone?: SceneZoneId;
  private lastPublishedGameName?: string;
  private lastPublishedNickname: string;
  private lastPublishedAvatarDataUrl?: string;
  private lastPublishedAvatarId?: BuiltInAvatarId;
  private lastPublishedCustomStatus?: string;
  private pendingConnection?: PendingConnection;
  private hasJoinedOnce = false;
  private unsubscribeEvents?: () => void;
  private audioRelay?: SignalingAudioRelay;
  private readonly remotePeerIds = new Set<string>();
  private readonly webrtcReadyPeerIds = new Set<string>();
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

  constructor(private readonly options: RoomClientOptions) {
    this.localStream = options.localStream;
    this.primaryInputTrack = options.localStream.getAudioTracks()[0];
    this.nickname = options.nickname;
    this.avatarDataUrl = options.avatarDataUrl;
    this.avatarId = options.avatarId;
    this.customStatus = options.customStatus;
    this.lastPublishedNickname = options.nickname;
    this.lastPublishedAvatarDataUrl = options.avatarDataUrl;
    this.lastPublishedAvatarId = options.avatarId;
    this.lastPublishedCustomStatus = options.customStatus;
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
    this.webrtcReadyPeerIds.clear();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.isSignalingConnected = false;
    await window.desktopApi.signaling.close().catch(() => undefined);
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
      audioRelayDiagnostics: this.audioRelay?.getDiagnostics(),
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

  updateProfile(
    nickname: string,
    avatarDataUrl?: string,
    avatarId?: BuiltInAvatarId,
    customStatus?: string,
  ): void {
    if (
      this.lastPublishedNickname === nickname &&
      this.lastPublishedAvatarDataUrl === avatarDataUrl &&
      this.lastPublishedAvatarId === avatarId &&
      this.lastPublishedCustomStatus === customStatus
    ) {
      return;
    }

    this.nickname = nickname;
    this.avatarDataUrl = avatarDataUrl;
    this.avatarId = avatarId;
    this.customStatus = customStatus;
    this.lastPublishedNickname = nickname;
    this.lastPublishedAvatarDataUrl = avatarDataUrl;
    this.lastPublishedAvatarId = avatarId;
    this.lastPublishedCustomStatus = customStatus;

    void this.safeSend({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      nickname,
      avatarId,
      customStatus,
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

  private openSocket(isReconnect: boolean): Promise<void> {
    this.options.onConnectionState(isReconnect ? RoomConnectionState.Reconnecting : RoomConnectionState.Joining);
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
        void window.desktopApi.signaling.close();
      }, INITIAL_CONNECT_TIMEOUT_MS);

      this.pendingConnection = { resolve, reject, timeout };
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = window.desktopApi.signaling.onEvent((payload) => {
        this.options.onDiagnosticEvent?.(payload);
        void this.handleBridgeEvent(payload).catch((error) => {
          this.handleBridgeFailure(error);
        });
      });

      void window.desktopApi.signaling.connect(this.options.signalingUrl).catch((error) => {
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
        customStatus: this.customStatus,
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
      this.audioRelay?.resetTransport("signaling_socket_closed");

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
      case "ice_candidate":
        await this.handleIceCandidate(payload);
        return;
      case "error":
        this.handleErrorMessage(payload);
        return;
      case "chat_message":
        this.handleChatMessage(payload);
        return;
      case "knock_event":
        this.handleKnockEvent(payload);
        return;
      case "audio_chunk":
        this.handleAudioChunk(payload);
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
      case "scene_reaction":
        this.handleSceneReaction(payload);
        return;
      case "room_note_update":
        this.options.onRoomNote(payload.note);
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
    if (
      this.lastPublishedDeafenState === isDeafened &&
      this.lastPublishedActivity === activity &&
      this.lastPublishedSceneZone === sceneZone &&
      this.lastPublishedGameName === gameName
    ) {
      return;
    }

    this.lastPublishedDeafenState = isDeafened;
    this.lastPublishedActivity = activity;
    this.lastPublishedSceneZone = sceneZone;
    this.lastPublishedGameName = gameName;
    void this.safeSend({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isDeafened,
      activity,
      sceneZone,
      gameName: gameName ?? "",
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
    void writeRendererLog("signaling", "info", "Join acknowledgement received", {
      roomId: payload.roomId,
      peerId: payload.peerId,
      revision: payload.revision,
      memberCount: payload.memberCount,
      protocolVersion: payload.protocolVersion,
      buildNumber: payload.buildNumber,
    });
  }

  private async handleRoomSnapshot(snapshot: RoomSnapshotMessage | ChannelSnapshotMessage): Promise<void> {
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
    this.options.onRoomNote(snapshot.roomNote);
    const normalizedMembers = snapshot.members.map((member) => ({
      ...member,
      avatarDataUrl: this.avatarCache.get(member.id)?.avatarDataUrl,
      presenceState:
        member.id === this.options.peerId || member.presenceState === MemberPresenceState.Online
          ? MemberPresenceState.Online
          : member.presenceState,
      speakingState: member.isMuted
        ? MemberSpeakingState.Muted
        : member.speakingState ?? MemberSpeakingState.Silent,
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
    this.startAudioRelay();
    this.updateAudioRelaySending();

    for (const peerId of [...this.peers.keys()]) {
      if (!activePeerIds.has(peerId)) {
        this.peers.get(peerId)?.destroy();
        this.peers.delete(peerId);
        this.webrtcReadyPeerIds.delete(peerId);
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
    const peer = this.peers.get(payload.peerId) ?? this.createPeer(payload.peerId);
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

  private async handleIceCandidate(payload: IceCandidateMessage): Promise<void> {
    const peer = this.peers.get(payload.peerId);
    if (!peer) {
      return;
    }

    await peer.addIceCandidate(payload.candidate);
  }

  private handleErrorMessage(payload: ErrorMessage): void {
    this.lastServerError = `${payload.code}:${payload.message}`;
    this.options.onConnectionState(RoomConnectionState.Failed);
    this.rejectPendingConnection(new Error(payload.message || payload.code));
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
        peerId: this.options.peerId,
        nickname: this.nickname,
        avatarId: this.avatarId,
        content: trimmed,
        createdAt: new Date().toISOString(),
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

  async sendSceneReaction(
    targetPeerId: string,
    emoji: SceneReaction["emoji"],
  ): Promise<void> {
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

  async updateRoomNote(content: string): Promise<void> {
    if (!this.canSendChat()) {
      throw new Error("signaling_not_connected");
    }
    await this.send({
      type: "room_note_update",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      note: {
        content: content.trim().slice(0, 80),
        authorName: this.nickname,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  private handleChatMessage(payload: SignalChatMessage): void {
    this.options.onChatMessage({
      id: `${payload.peerId}-${payload.createdAt}`,
      peerId: payload.peerId,
      nickname: payload.nickname,
      avatarDataUrl: payload.avatarDataUrl,
      avatarId: payload.avatarId,
      content: payload.content,
      createdAt: payload.createdAt,
      isLocal: payload.peerId === this.options.peerId,
    });
  }

  private handleKnockEvent(payload: KnockEventMessage): void {
    this.options.onKnock({
      id: `knock-${payload.peerId}-${payload.createdAt}`,
      peerId: payload.peerId,
      nickname: payload.nickname,
      content:
        payload.peerId === this.options.peerId
          ? "你敲了一下"
          : `${payload.nickname} 敲了一下`,
      createdAt: payload.createdAt,
      isLocal: payload.peerId === this.options.peerId,
      kind: "system",
    });
  }

  private handleAudioChunk(payload: AudioChunkMessage): void {
    this.audioRelay?.handleRemoteChunk(payload);
  }

  private handleScreenFrame(payload: ScreenFrameMessage): void {
    if (payload.peerId === this.options.peerId) {
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
    if (payload.peerId === this.options.peerId || payload.isSharing) {
      return;
    }

    this.options.onRemoteScreenFrame(payload.peerId, undefined);
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
        gameName:
          payload.gameName === ""
            ? undefined
            : payload.gameName ?? member.gameName,
        customStatus: payload.customStatus ?? member.customStatus,
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
    const hasPeerWithoutWebrtc = [...this.remotePeerIds].some(
      (peerId) => !this.webrtcReadyPeerIds.has(peerId),
    );
    this.audioRelay?.setShouldSend(hasPeerWithoutWebrtc);
    this.updateScreenFrameRelaySending();
  }

  private updateScreenFrameRelaySending(): void {
    const hasRemotePeers = this.remotePeerIds.size > 0;
    const hasPeerWithoutWebrtc = [...this.remotePeerIds].some(
      (peerId) => !this.webrtcReadyPeerIds.has(peerId),
    );
    const desiredInterval = hasPeerWithoutWebrtc
      ? SCREEN_FRAME_INTERVAL_MS
      : SCREEN_FRAME_HEALTHY_INTERVAL_MS;
    if (
      this.screenShareStream &&
      hasRemotePeers &&
      (!this.screenFrameTimer || this.screenFrameIntervalMs !== desiredInterval)
    ) {
      this.startScreenFrameRelay(this.screenShareStream, desiredInterval);
      return;
    }
    if ((!this.screenShareStream || !hasRemotePeers) && this.screenFrameTimer) {
      this.stopScreenFrameRelay();
    }
  }

  private createPeer(targetPeerId: string): MeshPeerConnection {
    const peer = new MeshPeerConnection({
      peerId: targetPeerId,
      localStream: this.localStream,
      onRemoteStream: (stream) => {
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
        if (state === "connected") {
          this.webrtcReadyPeerIds.add(targetPeerId);
          this.audioRelay?.markPeerPath(targetPeerId, "webrtc", "webrtc_connected");
          this.updateAudioRelaySending();
          void writeRendererLog("webrtc", "info", "Peer connection connected", {
            targetPeerId,
            audioRelayFallbackEnabled: false,
          });
          return;
        }

        if (state === "failed" || state === "disconnected" || state === "closed") {
          this.webrtcReadyPeerIds.delete(targetPeerId);
          this.audioRelay?.markPeerPath(targetPeerId, "relay", `webrtc_${state}`);
          this.updateAudioRelaySending();
          this.options.onRemoteStream(targetPeerId, undefined);
          void writeRendererLog("webrtc", "warn", "Peer connection unavailable, audio relay fallback enabled", {
            targetPeerId,
            state,
            audioRelayFallbackEnabled: true,
          });
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
    return peer;
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
    await window.desktopApi.signaling.send(JSON.stringify(payload));
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
    void window.desktopApi.signaling.close().catch(() => undefined);
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
    }
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

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      const error = new Error("signaling_reconnect_exhausted");
      this.shouldReconnect = false;
      this.options.onConnectionState(RoomConnectionState.Failed);
      this.clearPeers();
      this.audioRelay?.destroy();
      this.audioRelay = undefined;
      this.options.onReconnectExhausted?.(error);
      return;
    }

    this.reconnectAttempts += 1;
    this.options.onReconnectAttempt?.(this.reconnectAttempts);
    const delay = this.backoff.nextDelay();
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
    for (const [peerId, peer] of this.peers) {
      peer.destroy();
      this.options.onRemoteStream(peerId, undefined);
      this.options.onRemoteScreenFrame(peerId, undefined);
    }
    this.peers.clear();
    this.webrtcReadyPeerIds.clear();
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
    const microphoneSource = context.createMediaStreamSource(
      new MediaStream([microphoneTrack]),
    );
    const systemSource = context.createMediaStreamSource(
      new MediaStream([systemAudioTrack]),
    );
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
    video.addEventListener(
      "loadeddata",
      () => void this.captureAndSendScreenFrame(),
      { once: true },
    );
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
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
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
