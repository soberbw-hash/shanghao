import {
  HEARTBEAT_INTERVAL_MS,
  MAX_ROOM_MEMBERS,
  SIGNALING_PING_TIMEOUT_MS,
} from "@private-voice/shared";

import type { PeerSession } from "./peer-manager";
import { PeerManager } from "./peer-manager";

export interface SignalingRoom {
  roomId: string;
  roomName: string;
  peers: PeerManager;
  relayToken?: string;
}

export class RoomManager {
  private readonly rooms = new Map<string, SignalingRoom>();

  getOrCreateRoom(roomId: string, roomName: string, relayToken?: string): SignalingRoom {
    const existing = this.rooms.get(roomId);
    if (existing) {
      if (!existing.relayToken && relayToken) {
        existing.relayToken = relayToken;
      }
      return existing;
    }

    const room: SignalingRoom = {
      roomId,
      roomName,
      peers: new PeerManager(),
      relayToken,
    };

    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): SignalingRoom | undefined {
    return this.rooms.get(roomId);
  }

  addPeer(roomId: string, roomName: string, session: PeerSession, relayToken?: string): SignalingRoom {
    const room = this.getOrCreateRoom(roomId, roomName, relayToken);
    room.peers.addPeer(session);
    return room;
  }

  removePeer(roomId: string, peerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    room.peers.removePeer(peerId);
    if (room.peers.listPeers().length === 0) {
      this.rooms.delete(roomId);
    }
  }

  canJoin(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return true;
    }

    return room.peers.listPeers().length < MAX_ROOM_MEMBERS;
  }

  collectStalePeers(): Array<{ roomId: string; peerId: string }> {
    const stalePeers: Array<{ roomId: string; peerId: string }> = [];
    const staleAfterMs = SIGNALING_PING_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS;

    for (const room of this.rooms.values()) {
      for (const peer of room.peers.listPeers()) {
        if (Date.now() - peer.lastHeartbeatAt > staleAfterMs) {
          stalePeers.push({ roomId: room.roomId, peerId: peer.id });
        }
      }
    }

    return stalePeers;
  }
}
