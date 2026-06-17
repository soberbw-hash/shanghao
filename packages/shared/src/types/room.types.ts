import {
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
} from "../enums/app.enums";
import type {
  BuiltInAvatarId,
  RelayStatusSnapshot,
} from "./settings.types";

export interface ChatMessage {
  id: string;
  peerId: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  content: string;
  createdAt: string;
  isLocal?: boolean;
  kind?: "chat" | "system";
  /** 内置 AI 助手消息：头像使用软件品牌图标，昵称固定为"上号"。 */
  isBot?: boolean;
}

export type SceneZoneId =
  | "coffeeBar"
  | "fitnessZone"
  | "restroomZone"
  | "gameDesk1"
  | "gameDesk2"
  | "gameDesk3"
  | "gameDesk4"
  | "gameDesk5";

export type MemberActivity = "idle" | "gaming" | "drinking" | "fitness" | "restroom";

export interface RoomMember {
  id: string;
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
  presenceState: MemberPresenceState;
  speakingState: MemberSpeakingState;
  joinState?: MemberJoinState;
  volume: number;
  joinedAt: string;
  connectionQuality: "excellent" | "good" | "poor";
}

export interface HostEvent {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  memberName?: string;
  createdAt: string;
}

export interface RoomSummary {
  roomId: string;
  roomName: string;
  hostId?: string;
  memberCount: number;
  members: RoomMember[];
  signalingUrl?: string;
  connectionState: RoomConnectionState;
  lifecycleState: RoomLifecycleState;
  latestFailureReason?: string;
  recentHostEvents?: HostEvent[];
}

export interface ConnectionHealth {
  latencyMs: number;
  jitterMs: number;
  packetLossPercent: number;
  reconnectAttempt: number;
  lastUpdatedAt?: string;
}
