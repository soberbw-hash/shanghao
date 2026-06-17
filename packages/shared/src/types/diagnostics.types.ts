import { ExportTaskState } from "../enums/app.enums";
import type { RoomConnectionState, RoomLifecycleState } from "../enums/app.enums";
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
  context?: Record<string, unknown>;
  timestamp: string;
}

export interface DiagnosticsSnapshot {
  version: string;
  platform: string;
  logsDirectory: string;
  relay?: RelayStatusSnapshot;
  logStats: Record<string, number>;
  exportTask?: {
    state: ExportTaskState;
    filePath?: string;
    error?: string;
  };
}

export interface RendererDiagnosticsSummary {
  roomLifecycleState: RoomLifecycleState;
  roomConnectionState: RoomConnectionState;
  currentRoomId?: string;
  currentPeerId?: string;
  reconnectAttempts: number;
  lastSocketCloseCode?: number;
  lastSocketCloseReason?: string;
  lastSocketClosedAt?: string;
  activeClientExists: boolean;
  audioRelayState: string;
  localStreamActive: boolean;
  remotePeerCount: number;
  roomSnapshotRevision: number;
  chatSendFailures: number;
  serverClockOffsetMs?: number;
  audioStreamEpoch?: number;
  droppedExpiredChunks?: number;
  droppedSendChunks?: number;
  perPeerAudioStatus?: Record<string, string>;
  audioTimeline?: unknown[];
}

export interface DiagnosticsBundleSummary {
  version: string;
  platform: string;
  exportedAt: string;
  logStats: Record<string, number>;
  relay?: RelayStatusSnapshot;
}
