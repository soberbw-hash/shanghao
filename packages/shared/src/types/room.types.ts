import {
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
} from "../enums/app.enums";

export interface RoomMember {
  id: string;
  nickname: string;
  isHost: boolean;
  isLocal: boolean;
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
  connectionState: RoomConnectionState;
  lifecycleState: RoomLifecycleState;
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
  signalingPort: number;
  signalingUrl: string;
  tailscaleIp?: string;
}
