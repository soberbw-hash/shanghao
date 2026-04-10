import {
  DEFAULT_RECONNECT_DELAYS_MS,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  type RoomMember,
} from "@private-voice/shared";
import type {
  IceCandidateMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  RoomSnapshotMessage,
  SignalEnvelope,
} from "@private-voice/signaling";
import { MeshPeerConnection, ExponentialBackoff } from "@private-voice/webrtc";

interface RoomClientOptions {
  signalingUrl: string;
  roomId: string;
  peerId: string;
  nickname: string;
  localStream: MediaStream;
  onMembers: (members: RoomMember[]) => void;
  onRoomName: (roomName: string) => void;
  onConnectionState: (state: RoomConnectionState) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | undefined) => void;
}

export class RoomClient {
  private socket?: WebSocket;
  private readonly backoff = new ExponentialBackoff(DEFAULT_RECONNECT_DELAYS_MS);
  private readonly peers = new Map<string, MeshPeerConnection>();
  private heartbeatTimer?: number;
  private reconnectTimer?: number;
  private shouldReconnect = true;
  private localStream: MediaStream;

  constructor(private readonly options: RoomClientOptions) {
    this.localStream = options.localStream;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.options.onConnectionState(RoomConnectionState.Joining);
    this.socket = new WebSocket(this.options.signalingUrl);

    this.socket.onopen = () => {
      this.options.onConnectionState(RoomConnectionState.Connected);
      this.backoff.reset();

      this.send({
        type: "join_room",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
        nickname: this.options.nickname,
      });

      this.startHeartbeat();
    };

    this.socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      const payload = JSON.parse(event.data) as SignalEnvelope;
      this.handleSignal(payload);
    };

    this.socket.onclose = () => {
      if (!this.shouldReconnect) {
        return;
      }

      this.options.onConnectionState(RoomConnectionState.Reconnecting);
      this.stopHeartbeat();
      this.clearPeers();
      this.reconnect();
    };

    this.socket.onerror = () => {
      this.options.onConnectionState(RoomConnectionState.Failed);
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }

    this.send({
      type: "leave_room",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
    });

    this.clearPeers();
    this.socket?.close();
    this.options.onConnectionState(RoomConnectionState.Disconnected);
  }

  updateMuteState(isMuted: boolean, isSpeaking: boolean): void {
    this.send({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isMuted,
      isSpeaking,
    });
  }

  async replaceInputTrack(nextTrack: MediaStreamTrack): Promise<void> {
    const previousTracks = this.localStream.getAudioTracks();
    const nextStream = new MediaStream([nextTrack]);
    this.localStream = nextStream;

    await Promise.all(
      [...this.peers.values()].map((peer) => peer.replaceLocalTrack(nextTrack)),
    );

    previousTracks.forEach((track) => {
      if (track.id !== nextTrack.id) {
        track.stop();
      }
    });
  }

  private handleSignal(payload: SignalEnvelope): void {
    switch (payload.type) {
      case "room_snapshot":
        void this.handleRoomSnapshot(payload);
        return;
      case "peer_offer":
        void this.handlePeerOffer(payload);
        return;
      case "peer_answer":
        void this.handlePeerAnswer(payload);
        return;
      case "ice_candidate":
        void this.handleIceCandidate(payload);
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
        this.send({
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

    this.send({
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

  private createPeer(targetPeerId: string): MeshPeerConnection {
    const peer = new MeshPeerConnection({
      peerId: targetPeerId,
      localStream: this.localStream,
      onRemoteStream: (stream) => this.options.onRemoteStream(targetPeerId, stream),
      onIceCandidate: (candidate) => {
        this.send({
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

  private send(payload: SignalEnvelope): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({
        type: "heartbeat",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
      });
    }, 10000);
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
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearPeers(): void {
    for (const [peerId, peer] of this.peers) {
      peer.destroy();
      this.options.onRemoteStream(peerId, undefined);
    }
    this.peers.clear();
  }
}
