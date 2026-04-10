import { ExportTaskState } from "../enums/app.enums";

export type LogCategory =
  | "app"
  | "signaling"
  | "webrtc"
  | "audio"
  | "devices"
  | "recording"
  | "tailscale";

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
}
