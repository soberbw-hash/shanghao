import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  MAX_ROOM_MEMBERS,
  SIGNALING_PING_TIMEOUT_MS,
  type ConnectionMode,
} from "@private-voice/shared";

import type { PeerSession } from "./peer-manager";
import { PeerManager } from "./peer-manager";

export interface SignalingRoom {
  roomId: string;
  roomName: string;
  peers: PeerManager;
  relayToken?: string;
  revision: number;
  appVersion: string;
  protocolVersion: string;
  buildNumber: string;
  connectionMode: ConnectionMode;
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
      revision: 0,
      appVersion: "unknown",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      connectionMode: "relay",
    };

    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): SignalingRoom | undefined {
    return this.rooms.get(roomId);
  }

  getStats(): { activeRooms: number; connectedPeers: number } {
    return {
      activeRooms: this.rooms.size,
      connectedPeers: [...this.rooms.values()].reduce(
        (count, room) => count + room.peers.listConnectedPeers().length,
        0,
      ),
    };
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
    if (room.peers.listPeers().length === 0 && roomId !== "main") {
      this.rooms.delete(roomId);
    }
  }

  markPeerDisconnected(roomId: string, peerId: string, socket: PeerSession["socket"]): boolean {
    return this.rooms.get(roomId)?.peers.markDisconnected(peerId, socket) ?? false;
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
    const reconnectGraceMs = 20_000;

    for (const room of this.rooms.values()) {
      for (const peer of room.peers.listPeers()) {
        if (
          (peer.disconnectedAt && Date.now() - peer.disconnectedAt > reconnectGraceMs) ||
          (!peer.disconnectedAt && Date.now() - peer.lastHeartbeatAt > staleAfterMs)
        ) {
          stalePeers.push({ roomId: room.roomId, peerId: peer.id });
        }
      }
    }

    return stalePeers;
  }
}
