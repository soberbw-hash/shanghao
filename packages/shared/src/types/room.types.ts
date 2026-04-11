import {
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
} from "../enums/app.enums";
import type { ConnectionMode, ProxyDiagnostics } from "./settings.types";

export interface RoomMember {
  id: string;
  nickname: string;
  avatarPath?: string;
  avatarDataUrl?: string;
  isHost: boolean;
  isLocal: boolean;
  isEmptySlot?: boolean;
  isMuted: boolean;
  presenceState: MemberPresenceState;
  speakingState: MemberSpeakingState;
  volume: number;
  joinedAt: string;
  connectionQuality: "excellent" | "good" | "poor";
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
  connectionMode: ConnectionMode;
  tailscaleIp?: string;
  hostAddress: string;
  addressSource:
    | "magicdns"
    | "tailscale_ip"
    | "public_ip"
    | "relay"
    | "manual_public_host"
    | "unknown";
  alternativeAddresses?: string[];
  protocolVersion: string;
  appVersion: string;
  buildNumber: string;
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
    | "public_ip"
    | "relay"
    | "manual_public_host"
    | "unknown";
  tailscaleState?: string;
  failureStage: "validation" | "network" | "websocket" | "version" | "unknown";
  message: string;
  details: string[];
  proxyDiagnostics?: ProxyDiagnostics;
  protocolVersion?: string;
  appVersion?: string;
  buildNumber?: string;
}
