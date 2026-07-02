import {
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  type BuiltInAvatarId,
  type MemberActivity,
  type RoomMember,
  type SceneZoneId,
} from "@private-voice/shared";
import type { WebSocket } from "ws";

export interface PeerSession {
  id: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarHash?: string;
  avatarId?: BuiltInAvatarId;
  socket: WebSocket;
  isHost: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  isDeafened: boolean;
  activity: MemberActivity;
  sceneZone?: SceneZoneId;
  gameName?: string;
  customStatus?: string;
  joinedAt: string;
  lastHeartbeatAt: number;
  disconnectedAt?: number;
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

  listConnectedPeers(): PeerSession[] {
    return this.listPeers().filter((peer) => !peer.disconnectedAt);
  }

  markDisconnected(peerId: string, socket: WebSocket): boolean {
    const peer = this.peers.get(peerId);
    if (!peer || peer.socket !== socket) {
      return false;
    }

    peer.disconnectedAt = Date.now();
    return true;
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
      Pick<
        PeerSession,
        | "isMuted"
        | "isSpeaking"
        | "isDeafened"
        | "activity"
        | "sceneZone"
        | "gameName"
        | "customStatus"
        | "nickname"
        | "avatarDataUrl"
        | "avatarHash"
        | "avatarId"
      >
    >,
  ): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      for (const [key, value] of Object.entries(nextState)) {
        if (value !== undefined) {
          Object.assign(peer, { [key]: value });
        }
      }
    }
  }

  toRoomMembers(localPeerId?: string): RoomMember[] {
    return this.listPeers().map((peer) => ({
      id: peer.id,
      nickname: peer.nickname,
      avatarHash: peer.avatarHash,
      avatarId: peer.avatarId,
      isHost: peer.isHost,
      isLocal: peer.id === localPeerId,
      isMuted: peer.isMuted,
      isDeafened: peer.isDeafened,
      activity: peer.activity,
      sceneZone: peer.sceneZone,
      gameName: peer.gameName,
      customStatus: peer.customStatus,
      presenceState: peer.disconnectedAt
        ? MemberPresenceState.Reconnecting
        : MemberPresenceState.Online,
      speakingState: peer.isMuted
        ? MemberSpeakingState.Muted
        : peer.isSpeaking
          ? MemberSpeakingState.Speaking
          : MemberSpeakingState.Silent,
      joinState: peer.disconnectedAt ? MemberJoinState.Connecting : MemberJoinState.Joined,
      volume: 1,
      joinedAt: peer.joinedAt,
      connectionQuality: "good",
    }));
  }
}
