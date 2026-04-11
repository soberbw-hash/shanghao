import { cp, mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { app, dialog, shell } from "electron";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  ExportTaskState,
  type DiagnosticsSnapshot,
  type LogEntry,
  type RendererLogPayload,
} from "@private-voice/shared";

const execFileAsync = promisify(execFile);

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

  async openLogsDirectory(): Promise<void> {
    await shell.openPath(this.logsDirectory);
  }

  async exportLogs(): Promise<DiagnosticsSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      lastExportState: ExportTaskState.Running,
    };

    const result = await dialog.showOpenDialog({
      title: "导出上号日志",
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
        `shanghao-logs-${new Date().toISOString().replaceAll(":", "-")}`,
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

  async exportBundle(extraFiles: Array<{ name: string; content: string }>): Promise<DiagnosticsSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      lastExportState: ExportTaskState.Running,
    };

    const result = await dialog.showOpenDialog({
      title: "导出上号诊断包",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Idle,
      };
      return this.snapshot;
    }

    const [targetDirectory] = result.filePaths;
    if (!targetDirectory) {
      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Idle,
      };
      return this.snapshot;
    }

    const bundleRoot = path.join(
      targetDirectory,
      `shanghao-diagnostics-${new Date().toISOString().replaceAll(":", "-")}`,
    );
    const zipPath = `${bundleRoot}.zip`;

    try {
      await cp(this.logsDirectory, bundleRoot, { recursive: true });
      await writeFile(
        path.join(bundleRoot, "version.json"),
        JSON.stringify(
          {
            protocolVersion: APP_PROTOCOL_VERSION,
            buildNumber: APP_BUILD_NUMBER,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );

      for (const file of extraFiles) {
        await writeFile(path.join(bundleRoot, file.name), file.content, "utf8");
      }

      await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Compress-Archive -Path '${bundleRoot}\\*' -DestinationPath '${zipPath}' -Force`,
        ],
        { windowsHide: true },
      );

      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Success,
        lastBundlePath: zipPath,
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
