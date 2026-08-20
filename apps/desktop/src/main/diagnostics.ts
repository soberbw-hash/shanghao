import {
  appendFile,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { app, dialog, shell } from "electron";

import { platformService } from "./platform/PlatformService";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  ExportTaskState,
  type DiagnosticsSnapshot,
  type LogEntry,
  type RendererLogPayload,
  type RuntimeHealthSnapshot,
} from "@private-voice/shared";

import { FlightRecorder } from "./flight-recorder";

const execFileAsync = promisify(execFile);
const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;
const EXPORT_LOG_TRUNCATE_THRESHOLD_BYTES = 20 * 1024 * 1024;
const EXPORT_LOG_TAIL_BYTES = 2 * 1024 * 1024;
const MAIN_WATCHDOG_INTERVAL_MS = 1_000;
const MAIN_WATCHDOG_WARN_MS = 500;
const SENSITIVE_DIAGNOSTIC_KEY =
  /(path|file|recording|transcript|chat|messagebody|nickname|email|sid|token|authorization|cookie)/i;
const WINDOWS_PATH = /[a-z]:\\[^\s"']+/gi;

const sanitizeDiagnosticValue = (value: unknown, key = ""): unknown => {
  if (SENSITIVE_DIAGNOSTIC_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return value.replace(WINDOWS_PATH, "[local-path]");
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeDiagnosticValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeDiagnosticValue(childValue, childKey),
      ]),
    );
  }
  return value;
};

const isRotatedLogFile = (fileName: string): boolean => {
  if (fileName.endsWith(".log")) return true;

  const markerIndex = fileName.lastIndexOf(".log.");
  if (markerIndex <= 0) return false;

  const suffix = fileName.slice(markerIndex + 5);
  return (
    suffix.length > 0 &&
    suffix.length <= 3 &&
    [...suffix].every((character) => character >= "0" && character <= "9")
  );
};

const zipDirectory = async (sourceDir: string, targetPath: string): Promise<void> => {
  try {
    // The Windows app uses Compress-Archive; keep the generic fallback for development tools.
    if (platformService.isWindows) {
      await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Compress-Archive -Path '${sourceDir}${path.sep}*' -DestinationPath '${targetPath}' -Force`,
        ],
        { windowsHide: true },
      );
    } else {
      await execFileAsync("zip", ["-r", targetPath, "."], {
        cwd: sourceDir,
      });
    }
  } catch {
    // Fallback: tar.gz for any platform where zip isn't available
    await execFileAsync("tar", ["-czf", targetPath, "-C", sourceDir, "."]);
  }
};

export class DiagnosticsService {
  private readonly logsDirectory = path.join(app.getPath("userData"), "logs");
  private snapshot: DiagnosticsSnapshot = {
    logsDirectory: this.logsDirectory,
    lastExportState: ExportTaskState.Idle,
  };
  private logWriteQueue = Promise.resolve();
  private lastRuntimeHealthSnapshot?: RuntimeHealthSnapshot;
  private watchdogTimer?: NodeJS.Timeout;
  readonly flightRecorder = new FlightRecorder();

  async init(): Promise<void> {
    await mkdir(this.logsDirectory, { recursive: true });
    await this.compactOversizedLogs();
    this.startMainThreadWatchdog();
  }

  getSnapshot(): DiagnosticsSnapshot {
    return this.snapshot;
  }

  setRuntimeHealthSnapshot(snapshot: RuntimeHealthSnapshot): void {
    this.lastRuntimeHealthSnapshot = snapshot;
  }

  getRuntimeHealthSnapshot(): RuntimeHealthSnapshot | undefined {
    return this.lastRuntimeHealthSnapshot;
  }

  setLastUpdateCheckMessage(message: string): void {
    this.snapshot = {
      ...this.snapshot,
      lastUpdateCheckMessage: message,
    };
  }

  async writeLog(payload: RendererLogPayload): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      ...payload,
    };
    this.flightRecorder.recordLog(entry);

    const filePath = path.join(this.logsDirectory, `${payload.category}.log`);
    const line = `${JSON.stringify(entry)}\n`;
    this.logWriteQueue = this.logWriteQueue
      .catch(() => undefined)
      .then(async () => {
        await this.rotateLogIfNeeded(filePath, Buffer.byteLength(line, "utf8"));
        await appendFile(filePath, line, "utf8");
      });
    await this.logWriteQueue;
  }

  async openLogsDirectory(): Promise<void> {
    await shell.openPath(this.logsDirectory);
  }

  async exportLogs(): Promise<DiagnosticsSnapshot> {
    this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Running };

    const result = await dialog.showOpenDialog({
      title: "导出上号日志",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Idle };
      return this.snapshot;
    }

    try {
      const [targetDirectory] = result.filePaths;
      if (!targetDirectory) {
        this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Idle };
        return this.snapshot;
      }

      const exportDirectory = path.join(
        targetDirectory,
        `shanghao-logs-${new Date().toISOString().replaceAll(":", "-")}`,
      );
      await this.exportLogsToDirectory(exportDirectory);

      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Success,
        lastExportPath: exportDirectory,
      };
      return this.snapshot;
    } catch {
      this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Failed };
      return this.snapshot;
    }
  }

  async exportBundle(
    extraFiles: Array<{ name: string; content: string }>,
  ): Promise<DiagnosticsSnapshot> {
    this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Running };

    const result = await dialog.showOpenDialog({
      title: "导出上号诊断包",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Idle };
      return this.snapshot;
    }

    const [targetDirectory] = result.filePaths;
    if (!targetDirectory) {
      this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Idle };
      return this.snapshot;
    }

    const bundleRoot = path.join(
      targetDirectory,
      `shanghao-diagnostics-${new Date().toISOString().replaceAll(":", "-")}`,
    );
    const zipPath = `${bundleRoot}.zip`;

    try {
      await mkdir(bundleRoot, { recursive: true });
      const logStats = await this.exportLogsToDirectory(path.join(bundleRoot, "logs"), true);
      await writeFile(
        path.join(bundleRoot, "log-stats.json"),
        JSON.stringify(logStats, null, 2),
        "utf8",
      );
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

      await zipDirectory(bundleRoot, zipPath);

      this.snapshot = {
        ...this.snapshot,
        lastExportState: ExportTaskState.Success,
        lastBundlePath: zipPath,
      };
      return this.snapshot;
    } catch {
      this.snapshot = { ...this.snapshot, lastExportState: ExportTaskState.Failed };
      return this.snapshot;
    }
  }

  private async rotateLogIfNeeded(filePath: string, incomingBytes: number): Promise<void> {
    const currentSize = await stat(filePath)
      .then((value) => value.size)
      .catch(() => 0);
    if (currentSize + incomingBytes <= MAX_LOG_FILE_BYTES) {
      return;
    }

    await rm(`${filePath}.${MAX_LOG_FILES}`, { force: true });
    for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
      await rename(`${filePath}.${index}`, `${filePath}.${index + 1}`).catch(() => undefined);
    }
    await rename(filePath, `${filePath}.1`).catch(() => undefined);
  }

  private async compactOversizedLogs(): Promise<void> {
    const entries = await readdir(this.logsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !isRotatedLogFile(entry.name)) continue;

      const filePath = path.join(this.logsDirectory, entry.name);
      const originalSize = await stat(filePath)
        .then((value) => value.size)
        .catch(() => 0);
      if (originalSize <= MAX_LOG_FILE_BYTES) continue;

      const tailBytes = Math.min(originalSize, MAX_LOG_FILE_BYTES);
      const handle = await open(filePath, "r+");
      try {
        const buffer = Buffer.alloc(tailBytes);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          tailBytes,
          Math.max(0, originalSize - tailBytes),
        );
        let tail = buffer.subarray(0, bytesRead);
        if (originalSize > tailBytes) {
          const firstLineBreak = tail.indexOf(0x0a);
          if (firstLineBreak >= 0) tail = tail.subarray(firstLineBreak + 1);
        }
        await handle.write(tail, 0, tail.length, 0);
        await handle.truncate(tail.length);
      } finally {
        await handle.close();
      }
    }
  }

  private async exportLogsToDirectory(
    targetDirectory: string,
    sanitize = false,
  ): Promise<
    Array<{ file: string; originalSize: number; exportedSize: number; truncated: boolean }>
  > {
    await mkdir(targetDirectory, { recursive: true });
    const entries = await readdir(this.logsDirectory, { withFileTypes: true });
    const logStats: Array<{
      file: string;
      originalSize: number;
      exportedSize: number;
      truncated: boolean;
    }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const sourcePath = path.join(this.logsDirectory, entry.name);
      const targetPath = path.join(targetDirectory, entry.name);
      const originalSize = (await stat(sourcePath)).size;
      const truncated = originalSize > EXPORT_LOG_TRUNCATE_THRESHOLD_BYTES;

      if (sanitize) {
        const raw = await readFile(sourcePath, "utf8");
        const safeLines = raw
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.stringify(sanitizeDiagnosticValue(JSON.parse(line)));
            } catch {
              return JSON.stringify({ message: "[unparseable log entry omitted]" });
            }
          })
          .join("\n");
        await writeFile(targetPath, safeLines ? `${safeLines}\n` : "", "utf8");
      } else if (!truncated) {
        await copyFile(sourcePath, targetPath);
      } else {
        const exportedSize = Math.min(EXPORT_LOG_TAIL_BYTES, originalSize);
        const handle = await open(sourcePath, "r");
        try {
          const buffer = Buffer.alloc(exportedSize);
          await handle.read(buffer, 0, exportedSize, originalSize - exportedSize);
          await writeFile(targetPath, buffer);
        } finally {
          await handle.close();
        }
      }

      const exportedSize = (await stat(targetPath)).size;
      logStats.push({ file: entry.name, originalSize, exportedSize, truncated });
    }

    return logStats;
  }

  private startMainThreadWatchdog(): void {
    if (this.watchdogTimer) return;
    let expectedAt = Date.now() + MAIN_WATCHDOG_INTERVAL_MS;
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      const delayMs = Math.max(0, now - expectedAt);
      expectedAt = now + MAIN_WATCHDOG_INTERVAL_MS;
      if (delayMs < MAIN_WATCHDOG_WARN_MS) return;
      const memory = process.memoryUsage();
      this.flightRecorder.record({
        source: "main",
        level: "warn",
        event: "main_thread_watchdog_delay",
        metrics: {
          durationMs: delayMs,
          heapUsedBytes: memory.heapUsed,
          rssBytes: memory.rss,
          activeResources:
            typeof process.getActiveResourcesInfo === "function"
              ? process.getActiveResourcesInfo().length
              : null,
        },
      });
    }, MAIN_WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref();
  }
}
