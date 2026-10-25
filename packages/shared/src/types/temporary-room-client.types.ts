import type {
  TemporaryRoomProfile,
  TemporaryRoomSnapshot,
  TemporaryRoomVersion,
} from "./temporary-room.types";

export interface TemporaryPublicIdentity extends TemporaryRoomProfile {
  version: 1;
  deviceId: string;
  publicKey: string;
}
/** Main-owned connection handle. No ticket/private key/account bearer enters the renderer. */
export interface TemporaryRoomDescriptor {
  contextId: string;
  signalingUrl: string;
  roomId: string;
  peerId: string;
  nickname: string;
  avatarId?: TemporaryRoomProfile["avatarId"];
  avatarDataUrl?: string;
  connectionWarning?: string;
  roomName: string;
  room: TemporaryRoomSnapshot;
}
export interface TemporaryRoomClientState {
  contextId: string;
  status: "connected" | "reconnecting" | "ended";
  room?: TemporaryRoomSnapshot;
  error?: string;
}
export type TemporaryRoomManageRequest = {
  contextId: string;
  expected: TemporaryRoomVersion;
} & (
  { action: "lock"; locked: boolean } | { action: "kick"; memberId: string } | { action: "rotate" }
);
