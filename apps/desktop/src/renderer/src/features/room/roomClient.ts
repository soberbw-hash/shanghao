import {
  DEFAULT_RECONNECT_DELAYS_MS,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  type ConnectionMode,
  type RoomMember,
  type SignalingEventPayload,
} from "@private-voice/shared";
import type {
  ErrorMessage,
  IceCandidateMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  RoomSnapshotMessage,
  SignalEnvelope,
} from "@private-voice/signaling";
import { ExponentialBackoff, MeshPeerConnection } from "@private-voice/webrtc";

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
  onDiagnosticEvent?: (payload: SignalingEventPayload) => void;
}

interface PendingConnection {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
}

const INITIAL_CONNECT_TIMEOUT_MS = 10_000;

export class RoomClient {
  private readonly backoff = new ExponentialBackoff(DEFAULT_RECONNECT_DELAYS_MS);
  private readonly peers = new Map<string, MeshPeerConnection>();
  private readonly relayToken?: string;
  private heartbeatTimer?: number;
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

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearPendingConnection();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }

    void this.send({
      type: "leave_room",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
    });

    this.clearPeers();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    void window.desktopApi.signaling.close();
    this.options.onConnectionState(RoomConnectionState.Disconnected);
  }

  updateMuteState(isMuted: boolean, isSpeaking: boolean): void {
    if (this.lastPublishedMuteState === isMuted && this.lastPublishedSpeakingState === isSpeaking) {
      return;
    }

    this.lastPublishedMuteState = isMuted;
    this.lastPublishedSpeakingState = isSpeaking;
    void this.send({
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

    void this.send({
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

    previousTracks.forEach((track) => {
      if (track.id !== nextTrack.id) {
        track.stop();
      }
    });
  }

  private openSocket(isReconnect: boolean): Promise<void> {
    this.options.onConnectionState(isReconnect ? RoomConnectionState.Reconnecting : RoomConnectionState.Joining);

    return new Promise((resolve, reject) => {
      this.clearPendingConnection();
      const timeout = window.setTimeout(() => {
        const error = new Error("network_unreachable");
        this.rejectPendingConnection(error);
        void window.desktopApi.signaling.close();
      }, INITIAL_CONNECT_TIMEOUT_MS);

      this.pendingConnection = { resolve, reject, timeout };
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = window.desktopApi.signaling.onEvent((payload) => {
        this.options.onDiagnosticEvent?.(payload);
        void this.handleBridgeEvent(payload);
      });

      void window.desktopApi.signaling.connect(this.options.signalingUrl).catch((error) => {
        this.rejectPendingConnection(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async handleBridgeEvent(payload: SignalingEventPayload): Promise<void> {
    if (payload.type === "open") {
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
      this.stopHeartbeat();
      this.clearPendingConnection();

      if (!this.shouldReconnect) {
        return;
      }

      if (!this.hasJoinedOnce) {
        this.options.onConnectionState(RoomConnectionState.Failed);
        return;
      }

      this.options.onConnectionState(RoomConnectionState.Reconnecting);
      this.clearPeers();
      this.reconnect();
    }
  }

  private async handleSignal(payload: SignalEnvelope): Promise<void> {
    switch (payload.type) {
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
      default:
        return;
    }
  }

  private async handleRoomSnapshot(snapshot: RoomSnapshotMessage): Promise<void> {
    this.options.onRoomName(snapshot.roomName);
    const normalizedMembers = snapshot.members.map((member) => ({
      ...member,
      presenceState:
        member.id === this.options.peerId || member.presenceState === MemberPresenceState.Online
          ? MemberPresenceState.Online
          : member.presenceState,
      speakingState: member.isMuted
        ? MemberSpeakingState.Muted
        : member.speakingState ?? MemberSpeakingState.Silent,
    }));

    this.options.onMembers(normalizedMembers);
    this.options.onConnectionState(
      normalizedMembers.filter((member) => !member.isEmptySlot).length <= 1
        ? RoomConnectionState.WaitingPeer
        : RoomConnectionState.Connected,
    );
    this.backoff.reset();
    this.hasJoinedOnce = true;
    this.resolvePendingConnection();

    const activePeerIds = new Set(
      normalizedMembers
        .filter((member) => member.id !== this.options.peerId)
        .map((member) => member.id),
    );

    for (const peerId of [...this.peers.keys()]) {
      if (!activePeerIds.has(peerId)) {
        this.peers.get(peerId)?.destroy();
        this.peers.delete(peerId);
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
    this.options.onConnectionState(RoomConnectionState.Failed);
    this.rejectPendingConnection(new Error(payload.message || payload.code));
  }

  private createPeer(targetPeerId: string): MeshPeerConnection {
    const peer = new MeshPeerConnection({
      peerId: targetPeerId,
      localStream: this.localStream,
      onRemoteStream: (stream) => this.options.onRemoteStream(targetPeerId, stream),
      onIceCandidate: (candidate) => {
        void this.send({
          type: "ice_candidate",
          roomId: this.options.roomId,
          peerId: this.options.peerId,
          targetPeerId,
          candidate,
        });
      },
      onConnectionStateChange: (state) => {
        if (state === "failed" || state === "disconnected") {
          this.options.onRemoteStream(targetPeerId, undefined);
        }
      },
    });

    this.peers.set(targetPeerId, peer);
    return peer;
  }

  private async send(payload: SignalEnvelope): Promise<void> {
    await window.desktopApi.signaling.send(JSON.stringify(payload));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      void this.send({
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

  private reconnect(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }

    const delay = this.backoff.nextDelay();
    this.reconnectTimer = window.setTimeout(() => {
      void this.openSocket(true).catch(() => undefined);
    }, delay);
  }

  private clearPeers(): void {
    for (const [peerId, peer] of this.peers) {
      peer.destroy();
      this.options.onRemoteStream(peerId, undefined);
    }
    this.peers.clear();
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
