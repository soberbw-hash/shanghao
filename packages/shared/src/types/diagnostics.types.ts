import { ExportTaskState } from "../enums/app.enums";
import type {
  ConnectionMode,
  DirectHostProbeSummary,
  ProxyDiagnostics,
  RelayStatusSnapshot,
  TailscaleStatus,
} from "./settings.types";

export type LogCategory =
  | "app"
  | "renderer-startup"
  | "signaling"
  | "webrtc"
  | "audio"
  | "devices"
  | "recording"
  | "tailscale"
  | "connection-mode"
  | "proxy-diagnostics"
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
  connectionMode?: ConnectionMode;
  inviteAddress?: string;
  proxy?: ProxyDiagnostics;
  tailscale?: TailscaleStatus;
  directHost?: DirectHostProbeSummary;
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
