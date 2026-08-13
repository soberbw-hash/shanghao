import {
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  type BuiltInAvatarId,
  type MemberActivity,
  type MusicActivity,
  type WorkActivity,
  type RoomMember,
  type SceneZoneId,
} from "@private-voice/shared";
import type { WebSocket } from "ws";

export interface PeerSession {
  id: string;
  profileId?: string;
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
  gameIconDataUrl?: string;
  musicActivity?: MusicActivity;
  workActivity?: WorkActivity;
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
        | "nickname"
        | "avatarDataUrl"
        | "avatarHash"
        | "avatarId"
      >
    > & {
      gameIconDataUrl?: string | null;
      musicActivity?: MusicActivity | null;
      workActivity?: WorkActivity | null;
    },
  ): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      for (const [key, value] of Object.entries(nextState)) {
        if (key === "gameName" && value === "") {
          peer.gameName = undefined;
          continue;
        }
        if (key === "musicActivity" && value === null) {
          peer.musicActivity = undefined;
          continue;
        }
        if (key === "workActivity" && value === null) {
          peer.workActivity = undefined;
          continue;
        }
        if (key === "gameIconDataUrl" && value === null) {
          peer.gameIconDataUrl = undefined;
          continue;
        }
        if (value !== undefined) {
          Object.assign(peer, { [key]: value });
        }
      }
    }
  }

  toRoomMembers(localPeerId?: string): RoomMember[] {
    return this.listPeers().map((peer) => ({
      id: peer.id,
      profileId: peer.profileId,
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
      gameIconDataUrl: peer.gameIconDataUrl,
      musicActivity: peer.musicActivity,
      workActivity: peer.workActivity,
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
