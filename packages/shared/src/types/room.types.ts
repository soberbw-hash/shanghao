import {
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
} from "../enums/app.enums";
import type { BuiltInAvatarId, RelayStatusSnapshot } from "./settings.types";

export type ChatImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ChatImageAttachment {
  dataUrl: string;
  mimeType: ChatImageMimeType;
  width: number;
  height: number;
  fileName?: string;
}

export interface ChatMessage {
  id: string;
  clientMessageId?: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  content: string;
  image?: ChatImageAttachment;
  createdAt: string;
  isLocal?: boolean;
  kind?: "chat" | "system";
  deliveryState?: "sending" | "sent" | "failed";
  failureReason?: string;
  retryCount?: number;
}

export interface ChatRecallEvent {
  messageId: string;
  peerId: string;
  recalledAt: string;
}

export type RoomCollectionItemKind = "text" | "link" | "image" | "game";

export interface RoomCollectionItem {
  id: string;
  kind: RoomCollectionItemKind;
  title: string;
  content: string;
  createdByPeerId: string;
  createdByNickname: string;
  createdAt: string;
}

export interface SceneReaction {
  id: string;
  peerId: string;
  targetPeerId: string;
  emoji: "👍" | "🔥" | "😂" | "❤️" | "👏" | "😭" | "😮" | "💀" | "🎉" | "👀";
  createdAt: string;
}

export interface RoomQuickMessage {
  id: string;
  peerId: string;
  nickname: string;
  avatarId?: BuiltInAvatarId;
  content: string;
  presetId?: string;
  soundId?: string;
  mediaType?: "voice" | "music";
  createdAt: string;
  isLocal?: boolean;
}

export type SceneZoneId =
  "restroomZone" | "gameDesk1" | "gameDesk2" | "gameDesk3" | "gameDesk4" | "gameDesk5";

export type MemberActivity = "idle" | "gaming" | "drinking" | "fitness" | "restroom";

export type MusicProviderId = "spotify" | "netease" | "qqmusic" | "applemusic";

export interface MusicActivity {
  provider: MusicProviderId;
  providerName: string;
  trackTitle: string;
  artist?: string;
}

export interface RoomMember {
  id: string;
  /** Permanent Supabase Auth identity for signed-in members, or guest:<peerId> for guests. */
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  isGuest?: boolean;
  profileId?: string;
  nickname: string;
  avatarPath?: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  avatarHash?: string;
  isHost: boolean;
  isLocal: boolean;
  isEmptySlot?: boolean;
  isMuted: boolean;
  isDeafened?: boolean;
  activity?: MemberActivity;
  sceneZone?: SceneZoneId;
  gameName?: string;
  gameIconDataUrl?: string;
  musicActivity?: MusicActivity;
  latencyMs?: number;
  presenceState: MemberPresenceState;
  speakingState: MemberSpeakingState;
  joinState?: MemberJoinState;
  volume: number;
  joinedAt: string;
  connectionQuality: "excellent" | "good" | "poor";
}

export interface RoomEvent {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  memberName?: string;
  createdAt: string;
}

export interface RoomSummary {
  roomId: string;
  roomName: string;
  memberCount: number;
  members: RoomMember[];
  signalingUrl?: string;
  connectionState: RoomConnectionState;
  lifecycleState: RoomLifecycleState;
  latestFailureReason?: string;
  recentRoomEvents?: RoomEvent[];
  relayStatus?: RelayStatusSnapshot;
}

export interface ConnectionHealth {
  latencyMs: number;
  jitterMs: number;
  packetLossPercent: number;
  availableOutgoingBitrateKbps?: number;
  reconnectAttempt: number;
  voicePath?: "webrtc_direct" | "webrtc_turn" | "signaling_relay" | "unknown";
  turnConfigured?: boolean;
  relayFallbackActive?: boolean;
  lastUpdatedAt?: string;
}

export interface DailyRoomGameSummary {
  name: string;
  participantCount: number;
}

export interface DailyRoomGameActivity {
  identityId?: string;
  nickname: string;
  gameName: string;
  durationMs: number;
}

export interface DailyRoomParticipantSummary {
  identityId: string;
  nickname: string;
  presenceDurationMs: number;
  joinSessions: number;
  gameDurationMs: number;
  messageCount: number;
  screenShareCount: number;
  screenShareDurationMs: number;
  firstSeenAt: string;
  lastExitAt?: string;
}

export interface DailyRoomRecordingRecapMoment {
  title: string;
  description: string;
  startMs: number;
  endMs: number;
}

export interface DailyRoomRecordingRecap {
  recordingId: string;
  uploadedAt: string;
  description: string;
  summary: string[];
  highlights: DailyRoomRecordingRecapMoment[];
  funnyMoments: DailyRoomRecordingRecapMoment[];
  participantNicknames: string[];
  keywords: string[];
}

export interface DailyRoomReport {
  schemaVersion?: 1;
  revision?: number;
  updatedAt?: string;
  roomId: "main" | "side";
  date: string;
  hadActivity: boolean;
  participantCount: number;
  participantNicknames: string[];
  /** Server-generated shared multi-line recap. Every client sees the persisted same text. */
  commentary?: string;
  activeDurationMs: number;
  peakConcurrent: number;
  messageCount: number;
  screenShareCount: number;
  screenShareDurationMs?: number;
  games: DailyRoomGameSummary[];
  gameActivities: DailyRoomGameActivity[];
  participants?: DailyRoomParticipantSummary[];
  /** Local recording recaps appear here only after a user explicitly publishes them. */
  recordingRecaps?: DailyRoomRecordingRecap[];
  peakConcurrentAt?: string;
  lastExit?: {
    nickname: string;
    at: string;
  };
}
