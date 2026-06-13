import type { BuiltInAvatarId, ConnectionMode, RoomMember } from "@private-voice/shared";

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
  | JoinChannelMessage
  | LeaveRoomMessage
  | LeaveChannelMessage
  | HeartbeatMessage
  | PongMessage
  | JoinAckMessage
  | RequestSnapshotMessage
  | RoomSnapshotMessage
  | ChannelSnapshotMessage
  | AvatarUpdateMessage
  | PeerOfferMessage
  | PeerAnswerMessage
  | IceCandidateMessage
  | MemberStateMessage
  | ChatMessage
  | AudioChunkMessage
  | AudioResyncRequestMessage
  | AudioResyncAckMessage
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
  avatarId?: BuiltInAvatarId;
  relayToken?: string;
}

export interface JoinRoomMessage extends BaseMessage, VersionedMessage {
  type: "join_room";
  roomId: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  relayToken?: string;
}

export interface JoinChannelMessage extends BaseMessage, VersionedMessage {
  type: "join_channel";
  roomId: string;
  channelId: string;
  peerId: string;
  nickname: string;
  avatarId: BuiltInAvatarId;
  channelCode?: string;
}

export interface LeaveRoomMessage extends BaseMessage {
  type: "leave_room";
  roomId: string;
  peerId: string;
}

export interface LeaveChannelMessage extends BaseMessage {
  type: "leave_channel";
  roomId: string;
  peerId: string;
}

export interface HeartbeatMessage extends BaseMessage {
  type: "heartbeat";
  roomId: string;
  peerId: string;
  sentAt?: number;
}

export interface PongMessage extends BaseMessage {
  type: "pong";
  roomId: string;
  peerId: string;
  sentAt: number;
  serverTime: number;
}

export interface JoinAckMessage extends BaseMessage, VersionedMessage {
  type: "join_ack";
  roomId: string;
  peerId: string;
  serverTime: number;
  revision: number;
  memberCount: number;
}

export interface RequestSnapshotMessage extends BaseMessage {
  type: "request_snapshot";
  roomId: string;
  peerId: string;
}

export interface RoomSnapshotMessage extends BaseMessage, VersionedMessage {
  type: "room_snapshot";
  roomId: string;
  roomName: string;
  members: RoomMember[];
  revision: number;
  serverTime: number;
}

export interface ChannelSnapshotMessage extends Omit<RoomSnapshotMessage, "type"> {
  type: "channel_snapshot";
}

export interface AvatarUpdateMessage extends BaseMessage {
  type: "avatar_update";
  roomId: string;
  peerId: string;
  avatarHash?: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
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
  avatarId?: BuiltInAvatarId;
}

export interface ChatMessage extends BaseMessage {
  type: "chat_message";
  roomId: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  content: string;
  createdAt: string;
}

export interface AudioChunkMessage extends BaseMessage {
  type: "audio_chunk";
  roomId: string;
  peerId: string;
  sourcePeerId: string;
  audioSessionId: string;
  audioStreamEpoch: number;
  audioPath: "relay";
  sequence: number;
  sentAt: number;
  capturedAtMonotonic?: number;
  serverReceivedAt?: number;
  serverForwardedAt?: number;
  serverSequence?: number;
  durationMs: number;
  sampleRate: number;
  channelCount: 1;
  data: string;
  createdAt?: string;
}

export interface AudioResyncRequestMessage extends BaseMessage {
  type: "audio_resync_request";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  reason: string;
  currentAudioStreamEpoch: number;
  lastGoodSequence: number;
  droppedCount: number;
}

export interface AudioResyncAckMessage extends BaseMessage {
  type: "audio_resync_ack";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  audioSessionId: string;
  newAudioStreamEpoch: number;
  resetAt: number;
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
