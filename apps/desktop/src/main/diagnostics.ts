import { cp, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

import { app, dialog } from "electron";

import {
  ExportTaskState,
  type DiagnosticsSnapshot,
  type LogEntry,
  type RendererLogPayload,
} from "@private-voice/shared";

export class DiagnosticsService {
  private readonly logsDirectory = path.join(app.getPath("userData"), "logs");
  private snapshot: DiagnosticsSnapshot = {
    logsDirectory: this.logsDirectory,
    lastExportState: ExportTaskState.Idle,
  };

  async init(): Promise<void> {
    await mkdir(this.logsDirectory, { recursive: true });
  }

  getSnapshot(): DiagnosticsSnapshot {
    return this.snapshot;
  }

  async writeLog(payload: RendererLogPayload): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      ...payload,
    };

    const filePath = path.join(this.logsDirectory, `${payload.category}.log`);
    const line = `${JSON.stringify(entry)}\n`;
    await appendFile(filePath, line, "utf8");
  }

  async exportLogs(): Promise<DiagnosticsSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      lastExportState: ExportTaskState.Running,
    };

    const result = await dialog.showOpenDialog({
      title: "Export Quiet Team logs",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Idle,
      };
      return this.snapshot;
    }

    try {
      const [targetDirectory] = result.filePaths;
      if (!targetDirectory) {
        this.snapshot = {
          ...this.snapshot,
          lastExportState: ExportTaskState.Idle,
        };
        return this.snapshot;
      }

      const exportDirectory = path.join(
        targetDirectory,
        `quiet-team-logs-${new Date().toISOString().replaceAll(":", "-")}`,
      );
      await cp(this.logsDirectory, exportDirectory, { recursive: true });

      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Success,
        lastExportPath: exportDirectory,
      };
      return this.snapshot;
    } catch {
      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Failed,
      };
      return this.snapshot;
    }
  }
}
