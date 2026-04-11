import { ExportTaskState } from "../enums/app.enums";

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
  | "proxy-diagnostics";

export interface LogEntry {
  category: LogCategory;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface DiagnosticsSnapshot {
  logsDirectory: string;
  lastExportState: ExportTaskState;
  lastExportPath?: string;
  lastBundlePath?: string;
}
