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
  concealedSamples?: number;
  concealmentEvents?: number;
  silentConcealedSamples?: number;
  concealmentPercent?: number;
  averageJitterBufferDelayMs?: number;
  averageJitterBufferTargetDelayMs?: number;
  packetsDiscarded?: number;
  fecPacketsReceived?: number;
  fecPacketsDiscarded?: number;
  localCandidateType?: string;
  remoteCandidateType?: string;
  connectionType?: "p2p" | "relay" | "unknown";
}

export interface PeerHealthDiagnostics {
  peerId: string;
  level: "healthy" | "degraded" | "critical";
  trend: "improving" | "stable" | "degrading";
  degradationSource: "none" | "network" | "media_pipeline";
  score: number;
  rttMs?: number;
  jitterMs?: number;
  packetLossPercent?: number;
  concealmentPercent?: number;
  averageJitterBufferDelayMs?: number;
  availableOutgoingBitrateBps?: number;
  connectionType: "p2p" | "relay" | "unknown";
  iceState: string;
  audioFlow?: "warming" | "flowing" | "muted" | "stalled";
  packetsProgressing: boolean;
  lastRecoveryAt?: string;
  recoveryCount: number;
  sampledAt: string;
}

export type RealtimeFaultKind =
  | "signal_disconnect"
  | "stale_socket_close"
  | "duplicate_socket_close"
  | "snapshot_timeout"
  | "one_peer_audio_stall"
  | "screen_track_lost";

export interface RealtimeFaultCommand {
  kind: RealtimeFaultKind;
  peerId?: string;
  durationMs?: number;
}

export interface FlightRecorderEvent {
  id: number;
  timestamp: string;
  source: "main" | "renderer" | "realtime" | "screen" | "audio" | "ai" | "update";
  level: "debug" | "info" | "warn" | "error";
  event: string;
  metrics?: Record<string, string | number | boolean | null>;
}

export interface FlightRecorderSnapshot {
  capturedAt: string;
  retentionMs: number;
  capacity: number;
  droppedEvents: number;
  events: FlightRecorderEvent[];
}

export interface FramePerformanceSnapshot {
  displayRefreshRateHz?: number;
  actualFps?: number;
  onePercentLowFps?: number;
  frameTimeP95Ms?: number;
  frameTimeP99Ms?: number;
  longFrameCount: number;
  longTaskCount: number;
  longestTaskMs?: number;
  sampleWindowMs: number;
}

export interface ScreenSharePipelineDiagnostics {
  requested?: {
    width: number;
    height: number;
    framesPerSecond: number;
    maxBitrateBps: number;
  };
  capture?: {
    width?: number;
    height?: number;
    framesPerSecond?: number;
  };
  send: Record<
    string,
    {
      width?: number;
      height?: number;
      framesPerSecond?: number;
      bitrateBps?: number;
      framesEncoded?: number;
      framesSent?: number;
      qualityLimitationReason?: string;
    }
  >;
  receive: Record<
    string,
    {
      width?: number;
      height?: number;
      framesPerSecond?: number;
      bitrateBps?: number;
      framesDecoded?: number;
      framesDropped?: number;
      freezeCount?: number;
      totalFreezesDurationMs?: number;
      averageDecodeTimeMs?: number;
      jitterBufferDelayMs?: number;
    }
  >;
  present: Record<
    string,
    {
      framesPerSecond?: number;
      width?: number;
      height?: number;
      sampledAt: number;
    }
  >;
  fallback: {
    active: boolean;
    targetCount: number;
    activeForMs: number;
    overdue: boolean;
  };
  updatedAt: number;
}

export interface RendererRuntimeHealthInput {
  performance: FramePerformanceSnapshot;
  jsHeapUsedBytes?: number;
  jsHeapTotalBytes?: number;
  room?: RendererDiagnosticsSummary;
  trackCount: number;
  audioContextCount?: number;
  audioNodeCount?: number;
  listenerCount?: number;
  timerCount?: number;
  screenShare?: {
    active: boolean;
    fallbackActive: boolean;
    requestedWidth?: number;
    requestedHeight?: number;
    captureWidth?: number;
    captureHeight?: number;
    captureFps?: number;
  };
}

export interface RuntimeProcessHealth {
  pid: number;
  cpuPercent?: number;
  workingSetBytes?: number;
  privateBytes?: number;
  type: string;
}

export interface RuntimeHealthSnapshot {
  capturedAt: string;
  appVersion: string;
  protocolVersion: string;
  buildNumber: string;
  uptimeMs: number;
  main: RuntimeProcessHealth;
  renderer?: RuntimeProcessHealth & {
    jsHeapUsedBytes?: number;
    jsHeapTotalBytes?: number;
  };
  processes: RuntimeProcessHealth[];
  system: {
    totalMemoryBytes?: number;
    freeMemoryBytes?: number;
  };
  gpu: {
    hardwareAcceleration: boolean;
    featureStatus: Record<string, string>;
    vendor?: string;
    device?: string;
    driver?: string;
  };
  display: {
    id: string;
    label?: string;
    refreshRateHz?: number;
    scaleFactor: number;
    width: number;
    height: number;
  };
  rendererPerformance?: FramePerformanceSnapshot;
  realtime: {
    peerCount: number;
    reconnectAttempts: number;
    connectionGeneration?: number;
    trackCount: number;
    audioNodeCount?: number;
    audioContextCount?: number;
    timerCount?: number;
    listenerCount?: number;
    screenShareActive: boolean;
    screenFallbackActive: boolean;
  };
  queues: {
    signalingEvents?: number;
    aiJobs?: number;
    recordingJobs?: number;
  };
  flightRecorder: FlightRecorderSnapshot;
}

export interface RendererDiagnosticsSummary {
  roomLifecycleState: RoomLifecycleState;
  roomConnectionState: RoomConnectionState;
  serverUrl?: string;
  currentRoomId?: string;
  currentPeerId?: string;
  reconnectAttempts: number;
  connectionGeneration?: number;
  reconnectEpisodeId?: number;
  reconnectEpisodeActive?: boolean;
  reconnectStableSince?: string;
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
  peerHealth?: Record<string, PeerHealthDiagnostics>;
  longSessionAudio?: Array<{
    sampledAt: string;
    elapsedMs: number;
    peerConnectionCount: number;
    trackCount: number;
    mixerInputCount: number;
    audioNodeCount: number;
    audioContextCount: number;
    timerCount: number;
    averageLossPercent: number;
    averageJitterMs: number;
    averageConcealmentPercent: number;
    recoveryCount: number;
    degradedPeerCount: number;
  }>;
  connectionHealth?: ConnectionHealth;
  localAudioDiagnostics?: LocalAudioDiagnostics;
  relayStatus?: RelayStatusSnapshot;
  screenShareRelayState?: "active" | "inactive";
  screenShare?: ScreenSharePipelineDiagnostics;
  audioTimeline?: Array<Record<string, unknown>>;
}
