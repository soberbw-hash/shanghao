import {
  DEFAULT_RECONNECT_DELAYS_MS,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  type ChatMessage,
  type ConnectionMode,
  type RoomMember,
  type SignalingEventPayload,
} from "@private-voice/shared";
import type {
  AudioChunkMessage,
  AvatarUpdateMessage,
  ChatMessage as SignalChatMessage,
  ErrorMessage,
  IceCandidateMessage,
  JoinAckMessage,
  MemberStateMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  RoomSnapshotMessage,
  SignalEnvelope,
} from "@private-voice/signaling";
import { ExponentialBackoff, MeshPeerConnection } from "@private-voice/webrtc";

import { writeRendererLog } from "../../utils/logger";
import { SignalingAudioRelay } from "./signalingAudioRelay";

interface RoomClientOptions {
  signalingUrl: string;
  roomId: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
  localStream: MediaStream;
  connectionMode: ConnectionMode;
  appVersion: string;
  protocolVersion: string;
  buildNumber: string;
  onMembers: (members: RoomMember[]) => void;
  onRoomName: (roomName: string) => void;
  onConnectionState: (state: RoomConnectionState) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | undefined) => void;
  onChatMessage: (message: ChatMessage) => void;
  onDiagnosticEvent?: (payload: SignalingEventPayload) => void;
  onReconnectAttempt?: (attempt: number) => void;
  onReconnectExhausted?: (error: Error) => void;
  onSnapshotRevision?: (revision: number) => void;
}

interface PendingConnection {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
}

const INITIAL_CONNECT_TIMEOUT_MS = 10_000;
const SNAPSHOT_RETRY_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 4;

export class RoomClient {
  private readonly backoff = new ExponentialBackoff(DEFAULT_RECONNECT_DELAYS_MS);
  private readonly peers = new Map<string, MeshPeerConnection>();
  private readonly relayToken?: string;
  private heartbeatTimer?: number;
  private snapshotRetryTimer?: number;
  private reconnectTimer?: number;
  private shouldReconnect = true;
  private localStream: MediaStream;
  private nickname: string;
  private avatarDataUrl?: string;
  private lastPublishedMuteState?: boolean;
  private lastPublishedSpeakingState?: boolean;
  private lastPublishedNickname: string;
  private lastPublishedAvatarDataUrl?: string;
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
  private joinRoomSent = false;
  private joinAckReceived = false;
  private roomSnapshotReceived = false;
  private lastServerError?: string;

  constructor(private readonly options: RoomClientOptions) {
    this.localStream = options.localStream;
    this.nickname = options.nickname;
    this.avatarDataUrl = options.avatarDataUrl;
    this.lastPublishedNickname = options.nickname;
    this.lastPublishedAvatarDataUrl = options.avatarDataUrl;
    try {
      this.relayToken = new URL(options.signalingUrl).searchParams.get("relayToken") ?? undefined;
    } catch {
      this.relayToken = undefined;
    }
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
        type: "leave_room",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
      });
    }

    this.clearPeers();
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
      joinRoomSent: this.joinRoomSent,
      joinAckReceived: this.joinAckReceived,
      roomSnapshotReceived: this.roomSnapshotReceived,
      lastServerError: this.lastServerError,
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

  updateProfile(nickname: string, avatarDataUrl?: string): void {
    if (
      this.lastPublishedNickname === nickname &&
      this.lastPublishedAvatarDataUrl === avatarDataUrl
    ) {
      return;
    }

    this.nickname = nickname;
    this.avatarDataUrl = avatarDataUrl;
    this.lastPublishedNickname = nickname;
    this.lastPublishedAvatarDataUrl = avatarDataUrl;

    void this.safeSend({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      nickname,
      avatarDataUrl,
    });
  }

  async replaceInputTrack(nextTrack: MediaStreamTrack): Promise<void> {
    const previousTracks = this.localStream.getAudioTracks();
    const nextStream = new MediaStream([nextTrack]);
    this.localStream = nextStream;

    await Promise.all([...this.peers.values()].map((peer) => peer.replaceLocalTrack(nextTrack)));
    await this.audioRelay?.replaceLocalStream(nextStream);

    previousTracks.forEach((track) => {
      if (track.id !== nextTrack.id) {
        track.stop();
      }
    });
  }

  private openSocket(isReconnect: boolean): Promise<void> {
    this.options.onConnectionState(isReconnect ? RoomConnectionState.Reconnecting : RoomConnectionState.Joining);
    this.joinStage = "websocket_open";
    this.wsOpened = false;
    this.joinRoomSent = false;
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
      this.joinStage = "join_room_sent";
      this.options.onConnectionState(
        this.hasJoinedOnce ? RoomConnectionState.Reconnecting : RoomConnectionState.Handshaking,
      );

      await this.send({
        type: "join_room",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
        nickname: this.nickname,
        avatarDataUrl: this.avatarDataUrl,
        appVersion: this.options.appVersion,
        protocolVersion: this.options.protocolVersion,
        buildNumber: this.options.buildNumber,
        connectionMode: this.options.connectionMode,
        relayToken: this.relayToken,
      });
      this.joinRoomSent = true;
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
        await this.handleRoomSnapshot(payload);
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
      case "audio_chunk":
        this.handleAudioChunk(payload);
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

  private async handleRoomSnapshot(snapshot: RoomSnapshotMessage): Promise<void> {
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
      }
    }

    for (const member of normalizedMembers) {
      if (member.id === this.options.peerId || this.peers.has(member.id)) {
        continue;
      }

      if (this.options.peerId < member.id) {
        const peer = this.createPeer(member.id);
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
        avatarDataUrl: this.avatarDataUrl,
        content: trimmed,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.chatSendFailures += 1;
      throw error;
    }
  }

  private handleChatMessage(payload: SignalChatMessage): void {
    this.options.onChatMessage({
      id: `${payload.peerId}-${payload.createdAt}`,
      peerId: payload.peerId,
      nickname: payload.nickname,
      avatarDataUrl: payload.avatarDataUrl,
      content: payload.content,
      createdAt: payload.createdAt,
      isLocal: payload.peerId === this.options.peerId,
    });
  }

  private handleAudioChunk(payload: AudioChunkMessage): void {
    this.audioRelay?.handleRemoteChunk(payload);
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
          this.audioRelay?.clearPeer(targetPeerId, "webrtc_connected");
          this.updateAudioRelaySending();
          void writeRendererLog("webrtc", "info", "Peer connection connected", {
            targetPeerId,
            audioRelayFallbackEnabled: false,
          });
          return;
        }

        if (state === "failed" || state === "disconnected" || state === "closed") {
          this.webrtcReadyPeerIds.delete(targetPeerId);
          this.audioRelay?.clearPeer(targetPeerId, `webrtc_${state}`);
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
      });
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
    }
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
    }
    this.peers.clear();
    this.webrtcReadyPeerIds.clear();
    this.remotePeerIds.clear();
    this.updateAudioRelaySending();
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
