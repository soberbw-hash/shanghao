import {
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";
import type { WebSocket } from "ws";

export interface PeerSession {
  id: string;
  nickname: string;
  avatarDataUrl?: string;
  socket: WebSocket;
  isHost: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  joinedAt: string;
  lastHeartbeatAt: number;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerSession>();

  addPeer(session: PeerSession): void {
    this.peers.set(session.id, session);
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  getPeer(peerId: string): PeerSession | undefined {
    return this.peers.get(peerId);
  }

  listPeers(): PeerSession[] {
    return [...this.peers.values()];
  }

  updateHeartbeat(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastHeartbeatAt = Date.now();
    }
  }

  updateMemberState(
    peerId: string,
    nextState: Partial<
      Pick<PeerSession, "isMuted" | "isSpeaking" | "nickname" | "avatarDataUrl">
    >,
  ): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      Object.assign(peer, nextState);
    }
  }

  toRoomMembers(localPeerId?: string): RoomMember[] {
    return this.listPeers().map((peer) => ({
      id: peer.id,
      nickname: peer.nickname,
      avatarDataUrl: peer.avatarDataUrl,
      isHost: peer.isHost,
      isLocal: peer.id === localPeerId,
      isMuted: peer.isMuted,
      presenceState: MemberPresenceState.Online,
      speakingState: peer.isMuted
        ? MemberSpeakingState.Muted
        : peer.isSpeaking
          ? MemberSpeakingState.Speaking
          : MemberSpeakingState.Silent,
      volume: 1,
      joinedAt: peer.joinedAt,
      connectionQuality: "good",
    }));
  }
}
