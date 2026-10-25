import type { RoomSnapshotMessage, ChannelSnapshotMessage, ChannelCountsMessage } from "./protocol";
import type { SignalingRoom, RoomManager } from "./room-manager";

export function createChannelCounts(rooms: RoomManager): ChannelCountsMessage {
  return {
    type: "channel_counts",
    counts: {
      main: rooms.getConnectedPeerCount("main"),
      side: rooms.getConnectedPeerCount("side"),
    },
  };
}

/** One authoritative member projection for initial sync and subsequent broadcasts. */
export function createRoomSnapshot(
  room: SignalingRoom,
  localPeerId: string,
  serverTime = Date.now(),
): RoomSnapshotMessage | ChannelSnapshotMessage {
  return {
    type: room.roomId === "main" ? "channel_snapshot" : "room_snapshot",
    roomId: room.roomId,
    roomName: room.roomName,
    privateRoom: room.privateRoom
      ? { ...room.privateRoom, onlineCount: room.peers.listConnectedPeers().length }
      : undefined,
    members: room.peers.toRoomMembers(localPeerId),
    revision: room.revision,
    serverTime,
    appVersion: room.appVersion,
    protocolVersion: room.protocolVersion,
    buildNumber: room.buildNumber,
  };
}
