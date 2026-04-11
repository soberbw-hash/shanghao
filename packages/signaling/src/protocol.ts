import type { ConnectionMode, RoomMember } from "@private-voice/shared";

export interface SessionDescriptionPayload {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string | null;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalEnvelope =
  | HelloMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | HeartbeatMessage
  | RoomSnapshotMessage
  | PeerOfferMessage
  | PeerAnswerMessage
  | IceCandidateMessage
  | MemberStateMessage
  | ErrorMessage;

interface BaseMessage {
  type: string;
  roomId?: string;
  peerId?: string;
}

interface VersionedMessage {
  appVersion: string;
  protocolVersion: string;
  buildNumber: string;
  connectionMode: ConnectionMode;
}

export interface HelloMessage extends BaseMessage, VersionedMessage {
  type: "hello";
  roomId: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
}

export interface JoinRoomMessage extends BaseMessage, VersionedMessage {
  type: "join_room";
  roomId: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
}

export interface LeaveRoomMessage extends BaseMessage {
  type: "leave_room";
  roomId: string;
  peerId: string;
}

export interface HeartbeatMessage extends BaseMessage {
  type: "heartbeat";
  roomId: string;
  peerId: string;
}

export interface RoomSnapshotMessage extends BaseMessage, VersionedMessage {
  type: "room_snapshot";
  roomId: string;
  roomName: string;
  members: RoomMember[];
}

export interface PeerOfferMessage extends BaseMessage {
  type: "peer_offer";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  sdp: SessionDescriptionPayload;
}

export interface PeerAnswerMessage extends BaseMessage {
  type: "peer_answer";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  sdp: SessionDescriptionPayload;
}

export interface IceCandidateMessage extends BaseMessage {
  type: "ice_candidate";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  candidate: IceCandidatePayload;
}

export interface MemberStateMessage extends BaseMessage {
  type: "member_state";
  roomId: string;
  peerId: string;
  isMuted?: boolean;
  isSpeaking?: boolean;
  nickname?: string;
  avatarDataUrl?: string;
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  message: string;
}

export const isSignalEnvelope = (value: unknown): value is SignalEnvelope => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "type" in value;
};
