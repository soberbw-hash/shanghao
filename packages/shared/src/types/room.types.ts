import {
  HostSessionState,
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
} from "../enums/app.enums";
import type {
  BuiltInAvatarId,
  ConnectionMode,
  CloudflareTunnelStatus,
  DirectHostProbeSummary,
  ProxyDiagnostics,
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
  connectionMode: ConnectionMode;
  connectionState: RoomConnectionState;
  lifecycleState: RoomLifecycleState;
  hostAddress?: string;
  hostSessionState?: HostSessionState;
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

export interface HostSessionInfo {
  roomId: string;
  roomName: string;
  hostDisplayName: string;
  signalingPort?: number;
  signalingUrl: string;
  localSignalingUrl?: string;
  connectionMode: ConnectionMode;
  hostState: HostSessionState;
  tailscaleIp?: string;
  hostAddress: string;
  addressSource:
    | "magicdns"
    | "tailscale_ip"
    | "lan_ipv4"
    | "public_ip"
    | "relay"
    | "cloudflare_tunnel"
    | "manual_public_host"
    | "unknown";
  alternativeAddresses?: string[];
  protocolVersion: string;
  appVersion: string;
  buildNumber: string;
  directHostProbe?: DirectHostProbeSummary;
  relayStatus?: RelayStatusSnapshot;
  cloudflareTunnel?: CloudflareTunnelStatus;
  inviteExpiresAt?: string;
}

export interface JoinRoomDiagnostic {
  signalingUrl: string;
  connectionMode: ConnectionMode;
  host?: string;
  port?: number;
  isUrlValid: boolean;
  isReachable: boolean;
  addressSource:
    | "magicdns"
    | "tailscale_ip"
    | "lan_ipv4"
    | "public_ip"
    | "relay"
    | "cloudflare_tunnel"
    | "manual_public_host"
    | "unknown";
  tailscaleState?: string;
  failureStage: "validation" | "network" | "websocket" | "version" | "relay" | "unknown";
  message: string;
  details: string[];
  proxyDiagnostics?: ProxyDiagnostics;
  protocolVersion?: string;
  appVersion?: string;
  buildNumber?: string;
  relayStatus?: RelayStatusSnapshot;
  directHostProbe?: DirectHostProbeSummary;
}
