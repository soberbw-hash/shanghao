import { ExportTaskState } from "../enums/app.enums";
import type { RoomConnectionState, RoomLifecycleState } from "../enums/app.enums";
import type { LocalAudioDiagnostics } from "./audio.types";
import type { ConnectionHealth } from "./room.types";
import type { RelayStatusSnapshot } from "./settings.types";

export type LogCategory =
  | "app"
  | "renderer-startup"
  | "signaling"
  | "webrtc"
  | "audio"
  | "devices"
  | "recording"
  | "relay"
  | "updates";

export interface LogEntry {
  category: LogCategory;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface DiagnosticsBundleSummary {
  appVersion?: string;
  protocolVersion?: string;
  buildNumber?: string;
  serverUrl?: string;
  currentRoomId?: string;
  currentPeerId?: string;
  relay?: RelayStatusSnapshot;
  exportedAt: string;
}

export interface DiagnosticsSnapshot {
  logsDirectory: string;
  lastExportState: ExportTaskState;
  lastExportPath?: string;
  lastBundlePath?: string;
  lastUpdateCheckMessage?: string;
}

export interface PeerConnectionDiagnostics {
  jitterMs?: number;
  packetsLost?: number;
  packetsReceived?: number;
  packetLossPercent?: number;
  roundTripTimeMs?: number;
  audioLevel?: number;
  localCandidateType?: string;
  remoteCandidateType?: string;
  connectionType?: "p2p" | "relay" | "unknown";
}

export interface RendererDiagnosticsSummary {
  roomLifecycleState: RoomLifecycleState;
  roomConnectionState: RoomConnectionState;
  serverUrl?: string;
  currentRoomId?: string;
  currentPeerId?: string;
  reconnectAttempts: number;
  lastSocketCloseCode?: number;
  lastSocketCloseReason?: string;
  lastSocketClosedAt?: string;
  activeClientExists: boolean;
  audioRelayState: "active" | "inactive";
  localStreamActive: boolean;
  remotePeerCount: number;
  webrtcReadyPeerCount?: number;
  turnConfigured?: boolean;
  peerRecoveryAttempts?: Record<string, number>;
  roomSnapshotRevision: number;
  chatSendFailures: number;
  joinStage?: string;
  wsOpened?: boolean;
  joinChannelSent?: boolean;
  joinAckReceived?: boolean;
  roomSnapshotReceived?: boolean;
  lastServerError?: string;
  serverClockOffsetMs?: number;
  audioStreamEpoch?: number;
  droppedExpiredChunks?: number;
  droppedSendChunks?: number;
  perPeerAudioStatus?: Array<Record<string, unknown>>;
  peerConnectionStats?: Record<string, PeerConnectionDiagnostics>;
  connectionHealth?: ConnectionHealth;
  localAudioDiagnostics?: LocalAudioDiagnostics;
  relayStatus?: RelayStatusSnapshot;
  screenShareRelayState?: "active" | "inactive";
  audioTimeline?: Array<Record<string, unknown>>;
}
