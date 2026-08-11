import type {
  BuiltInAvatarId,
  ChatImageAttachment,
  MemberActivity,
  MusicActivity,
  RoomMember,
  RoomCollectionItem,
  SceneZoneId,
} from "@private-voice/shared";
import { isAllowedNickname, isBuiltInAvatarId } from "@private-voice/shared";

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
  | JoinChannelMessage
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
  | PeerRestartRequestMessage
  | IceCandidateMessage
  | MemberStateMessage
  | ChatMessage
  | ChatRecallMessage
  | ChatHistoryMessage
  | ChannelCountsMessage
  | RoomCollectionSnapshotMessage
  | RoomCollectionAddMessage
  | RoomCollectionRemoveMessage
  | KnockEventMessage
  | AudioChunkMessage
  | AudioPathStateMessage
  | AudioResyncRequestMessage
  | AudioResyncAckMessage
  | ScreenFrameMessage
  | ScreenShareStateMessage
  | ScreenPathStateMessage
  | SceneReactionMessage
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
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface JoinChannelMessage extends BaseMessage, VersionedMessage {
  type: "join_channel";
  roomId: string;
  channelId: string;
  peerId: string;
  profileId?: string;
  nickname: string;
  avatarId: BuiltInAvatarId;
  sessionToken?: string;
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
  sessionToken: string;
  iceServers?: IceServerConfig[];
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

export interface PeerRestartRequestMessage extends BaseMessage {
  type: "peer_restart_request";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  reason: string;
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
  isDeafened?: boolean;
  activity?: MemberActivity;
  sceneZone?: SceneZoneId;
  gameName?: string;
  musicActivity?: MusicActivity | null;
  nickname?: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
}

export interface ChatMessage extends BaseMessage {
  type: "chat_message";
  roomId: string;
  id?: string;
  peerId?: string;
  nickname?: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  content: string;
  image?: ChatImageAttachment;
  createdAt?: string;
}

export type ServerChatMessage = Required<
  Pick<ChatMessage, "id" | "peerId" | "nickname" | "content" | "createdAt">
> &
  Pick<ChatMessage, "avatarId" | "avatarDataUrl" | "image">;

export interface ChatHistoryMessage extends BaseMessage {
  type: "chat_history";
  roomId: string;
  messages: ServerChatMessage[];
}

export interface ChatRecallMessage extends BaseMessage {
  type: "chat_recall";
  roomId: string;
  peerId?: string;
  messageId: string;
  recalledAt?: string;
}

export interface ChannelCountsMessage extends BaseMessage {
  type: "channel_counts";
  counts: {
    main: number;
    side: number;
  };
}

export interface RoomCollectionSnapshotMessage extends BaseMessage {
  type: "room_collection_snapshot";
  roomId: string;
  items: RoomCollectionItem[];
  replace?: boolean;
}

export interface RoomCollectionAddMessage extends BaseMessage {
  type: "room_collection_add";
  roomId: string;
  peerId?: string;
  item?: RoomCollectionItem;
  kind?: RoomCollectionItem["kind"];
  title?: string;
  content?: string;
}

export interface RoomCollectionRemoveMessage extends BaseMessage {
  type: "room_collection_remove";
  roomId: string;
  peerId?: string;
  itemId: string;
}

export interface KnockEventMessage extends BaseMessage {
  type: "knock_event";
  roomId: string;
  peerId: string;
  nickname: string;
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
  codec?: "pcm_s16le" | "mulaw";
  targetPeerIds?: string[];
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

export interface AudioPathStateMessage extends BaseMessage {
  type: "audio_path_state";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  needsRelay: boolean;
  reason: string;
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

export interface ScreenFrameMessage extends BaseMessage {
  type: "screen_frame";
  roomId: string;
  peerId: string;
  sourcePeerId: string;
  sequence: number;
  sentAt: number;
  width: number;
  height: number;
  data: string;
  targetPeerIds?: string[];
}

export interface ScreenShareStateMessage extends BaseMessage {
  type: "screen_share_state";
  roomId: string;
  peerId: string;
  isSharing: boolean;
}

export interface ScreenPathStateMessage extends BaseMessage {
  type: "screen_path_state";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  needsRelay: boolean;
  reason: string;
}

export interface SceneReactionMessage extends BaseMessage {
  type: "scene_reaction";
  roomId: string;
  peerId: string;
  targetPeerId: string;
  emoji: "👍" | "🔥" | "😂" | "❤️" | "👏" | "😭" | "😮" | "💀" | "🎉" | "👀";
  createdAt: string;
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  message: string;
  avatarId?: BuiltInAvatarId;
  availableAvatarIds?: BuiltInAvatarId[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isText = (value: unknown, maxLength: number, allowEmpty = false): value is string =>
  typeof value === "string" && value.length <= maxLength && (allowEmpty || value.trim().length > 0);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;

const isOptionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === "boolean";

const isIdentifier = (value: unknown, maxLength: number): value is string =>
  isText(value, maxLength) && /^[A-Za-z0-9._:-]+$/.test(value);

const isTimestamp = (value: unknown): value is number =>
  isFiniteNumber(value) && Math.abs(value - Date.now()) <= 24 * 60 * 60 * 1_000;

const isBase64 = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  value.length % 4 === 0 &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(value);

const decodeBase64Prefix = (value: string, maxBytes: number): number[] => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;

  for (const character of value) {
    if (character === "=" || bytes.length >= maxBytes) break;
    const index = alphabet.indexOf(character);
    if (index < 0) return [];
    buffer = (buffer << 6) | index;
    bitCount += 6;
    if (bitCount < 8) continue;
    bitCount -= 8;
    bytes.push((buffer >> bitCount) & 0xff);
    buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
  }

  return bytes;
};

const hasChatImageSignature = (mimeType: string, base64Payload: string): boolean => {
  const bytes = decodeBase64Prefix(base64Payload, 12);
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
};

export const isChatImageAttachment = (value: unknown): value is ChatImageAttachment => {
  if (!isRecord(value)) return false;
  const mimeType = String(value.mimeType);
  const dataUrl = String(value.dataUrl);
  const prefix = `data:${mimeType};base64,`;
  const base64Payload = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : "";
  return (
    ["image/png", "image/jpeg", "image/webp"].includes(mimeType) &&
    isText(dataUrl, 180_000) &&
    isBase64(base64Payload, 180_000) &&
    hasChatImageSignature(mimeType, base64Payload) &&
    isIntegerInRange(value.width, 1, 1_600) &&
    isIntegerInRange(value.height, 1, 1_600) &&
    (value.fileName === undefined || isText(value.fileName, 80))
  );
};

const SCENE_ZONES = new Set([
  "restroomZone",
  "gameDesk1",
  "gameDesk2",
  "gameDesk3",
  "gameDesk4",
  "gameDesk5",
]);
const MEMBER_ACTIVITIES = new Set(["idle", "gaming", "drinking", "fitness", "restroom"]);

export const isValidNickname = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed === value &&
    Array.from(trimmed).length >= 1 &&
    Array.from(trimmed).length <= 16 &&
    isAllowedNickname(trimmed) &&
    // Intentional control-character rejection for user-visible identity fields.
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001F\u007F\r\n]/.test(trimmed)
  );
};

const hasRoom = (value: Record<string, unknown>): boolean => isIdentifier(value.roomId, 64);

const hasPeer = (value: Record<string, unknown>): boolean => isIdentifier(value.peerId, 128);

const hasTarget = (value: Record<string, unknown>): boolean =>
  isIdentifier(value.targetPeerId, 128);

export const isSignalEnvelope = (value: unknown): value is SignalEnvelope => {
  if (!isRecord(value) || !isText(value.type, 64)) return false;

  switch (value.type) {
    case "join_channel":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        (value.profileId === undefined ||
          (isText(value.profileId, 64) &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              value.profileId,
            ))) &&
        isIdentifier(value.channelId, 64) &&
        isValidNickname(value.nickname) &&
        isBuiltInAvatarId(value.avatarId) &&
        isText(value.appVersion, 32) &&
        isText(value.protocolVersion, 32) &&
        isText(value.buildNumber, 64) &&
        (value.sessionToken === undefined || isText(value.sessionToken, 128))
      );
    case "leave_channel":
    case "request_snapshot":
      return hasRoom(value) && hasPeer(value);
    case "heartbeat":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        (value.sentAt === undefined || isTimestamp(value.sentAt))
      );
    case "pong":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        isFiniteNumber(value.sentAt) &&
        isFiniteNumber(value.serverTime)
      );
    case "join_ack":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        isFiniteNumber(value.serverTime) &&
        isFiniteNumber(value.revision) &&
        isText(value.sessionToken, 128)
      );
    case "room_snapshot":
    case "channel_snapshot":
      return (
        hasRoom(value) &&
        Array.isArray(value.members) &&
        isFiniteNumber(value.revision) &&
        isFiniteNumber(value.serverTime)
      );
    case "avatar_update":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        (value.avatarId === undefined || isBuiltInAvatarId(value.avatarId)) &&
        (value.avatarDataUrl === undefined ||
          (isText(value.avatarDataUrl, 180_000) &&
            /^data:image\/(?:png|jpeg|webp);base64,/.test(value.avatarDataUrl)))
      );
    case "peer_offer":
    case "peer_answer":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        hasTarget(value) &&
        isRecord(value.sdp) &&
        ["offer", "answer", "pranswer", "rollback"].includes(String(value.sdp.type)) &&
        (value.sdp.sdp === undefined ||
          value.sdp.sdp === null ||
          isText(value.sdp.sdp, 220_000, true))
      );
    case "peer_restart_request":
      return hasRoom(value) && hasPeer(value) && hasTarget(value) && isText(value.reason, 160);
    case "ice_candidate":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        hasTarget(value) &&
        isRecord(value.candidate) &&
        isText(value.candidate.candidate, 16_384, true) &&
        (value.candidate.sdpMid === undefined ||
          value.candidate.sdpMid === null ||
          isText(value.candidate.sdpMid, 256, true)) &&
        (value.candidate.sdpMLineIndex === undefined ||
          value.candidate.sdpMLineIndex === null ||
          isIntegerInRange(value.candidate.sdpMLineIndex, 0, 128))
      );
    case "member_state":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        isOptionalBoolean(value.isMuted) &&
        isOptionalBoolean(value.isSpeaking) &&
        isOptionalBoolean(value.isDeafened) &&
        (value.activity === undefined || MEMBER_ACTIVITIES.has(String(value.activity))) &&
        (value.sceneZone === undefined || SCENE_ZONES.has(String(value.sceneZone))) &&
        // v0.1.50 sent an empty game name when no game was detected. Accept it on the
        // wire for backwards compatibility; the server normalizes it to undefined.
        (value.gameName === undefined || isText(value.gameName, 64, true)) &&
        (value.musicActivity === undefined ||
          value.musicActivity === null ||
          (isRecord(value.musicActivity) &&
            ["spotify", "netease", "qqmusic", "applemusic"].includes(
              String(value.musicActivity.provider),
            ) &&
            isText(value.musicActivity.providerName, 32) &&
            isText(value.musicActivity.trackTitle, 160) &&
            (value.musicActivity.artist === undefined ||
              isText(value.musicActivity.artist, 100, true)))) &&
        (value.nickname === undefined || isValidNickname(value.nickname)) &&
        (value.avatarId === undefined || isBuiltInAvatarId(value.avatarId)) &&
        (value.avatarDataUrl === undefined ||
          (isText(value.avatarDataUrl, 180_000) &&
            /^data:image\/(?:png|jpeg|webp);base64,/.test(value.avatarDataUrl)))
      );
    case "chat_message": {
      const hasContent = isText(value.content, 500);
      const hasImage = isChatImageAttachment(value.image);
      return (
        hasRoom(value) &&
        typeof value.content === "string" &&
        value.content.length <= 500 &&
        (value.image === undefined || hasImage) &&
        (hasContent || hasImage)
      );
    }
    case "chat_recall":
      return hasRoom(value) && isIdentifier(value.messageId, 128);
    case "chat_history":
      return hasRoom(value) && Array.isArray(value.messages) && value.messages.length <= 100;
    case "channel_counts":
      return (
        isRecord(value.counts) &&
        isIntegerInRange(value.counts.main, 0, 5) &&
        isIntegerInRange(value.counts.side, 0, 5)
      );
    case "room_collection_snapshot":
      return (
        hasRoom(value) &&
        Array.isArray(value.items) &&
        value.items.length <= 128 &&
        (value.replace === undefined || typeof value.replace === "boolean")
      );
    case "room_collection_add":
      return (
        hasRoom(value) &&
        ["text", "link", "image", "game"].includes(String(value.kind)) &&
        isText(value.title, 80) &&
        isText(value.content, 2_000)
      );
    case "room_collection_remove":
      return hasRoom(value) && isIdentifier(value.itemId, 128);
    case "knock_event":
      return hasRoom(value) && hasPeer(value);
    case "audio_chunk":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        isBase64(value.data, 128_000) &&
        isIdentifier(value.audioSessionId, 128) &&
        isIntegerInRange(value.audioStreamEpoch, 0, Number.MAX_SAFE_INTEGER) &&
        isIntegerInRange(value.sequence, 0, Number.MAX_SAFE_INTEGER) &&
        isTimestamp(value.sentAt) &&
        isFiniteNumber(value.durationMs) &&
        value.durationMs > 0 &&
        value.durationMs <= 200 &&
        isIntegerInRange(value.sampleRate, 8_000, 48_000) &&
        value.channelCount === 1 &&
        (value.codec === undefined || value.codec === "pcm_s16le" || value.codec === "mulaw") &&
        (value.targetPeerIds === undefined ||
          (Array.isArray(value.targetPeerIds) &&
            value.targetPeerIds.length <= 5 &&
            value.targetPeerIds.every((peerId) => isText(peerId, 128))))
      );
    case "audio_resync_request":
    case "audio_resync_ack":
      return hasRoom(value) && hasPeer(value) && hasTarget(value);
    case "audio_path_state":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        hasTarget(value) &&
        typeof value.needsRelay === "boolean" &&
        isText(value.reason, 128)
      );
    case "screen_frame":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        isText(value.data, 220_000) &&
        /^data:image\/(?:jpeg|webp);base64,/.test(value.data) &&
        isIntegerInRange(value.sequence, 0, Number.MAX_SAFE_INTEGER) &&
        isTimestamp(value.sentAt) &&
        isIntegerInRange(value.width, 1, 4_096) &&
        isIntegerInRange(value.height, 1, 2_160) &&
        (value.targetPeerIds === undefined ||
          (Array.isArray(value.targetPeerIds) &&
            value.targetPeerIds.length <= 5 &&
            value.targetPeerIds.every((peerId) => isText(peerId, 128))))
      );
    case "screen_share_state":
      return hasRoom(value) && hasPeer(value) && typeof value.isSharing === "boolean";
    case "screen_path_state":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        hasTarget(value) &&
        typeof value.needsRelay === "boolean" &&
        isText(value.reason, 128)
      );
    case "scene_reaction":
      return (
        hasRoom(value) &&
        hasPeer(value) &&
        hasTarget(value) &&
        ["👍", "🔥", "😂", "❤️", "👏", "😭", "😮", "💀", "🎉", "👀"].includes(String(value.emoji))
      );
    case "error":
      return (
        isText(value.code, 64) &&
        isText(value.message, 500) &&
        (value.avatarId === undefined || isBuiltInAvatarId(value.avatarId)) &&
        (value.availableAvatarIds === undefined ||
          (Array.isArray(value.availableAvatarIds) &&
            value.availableAvatarIds.length <= 5 &&
            value.availableAvatarIds.every(isBuiltInAvatarId)))
      );
    default:
      return false;
  }
};
