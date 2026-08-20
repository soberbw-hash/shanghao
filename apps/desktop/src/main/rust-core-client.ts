import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { app } from "electron";

import { runLocalProcess } from "./local-process";
import { platformService } from "./platform/PlatformService";

export interface RustCoreCapabilities {
  protocolVersion: number;
  platform: string;
  commands: string[];
  nativeActivity: boolean;
  stableFileIdentity: boolean;
  processSupervision: boolean;
}

export interface RustActivitySnapshot {
  available: boolean;
  pid?: number;
  windowTitle?: string;
  executablePath?: string;
}

export interface RustFileIdentity {
  stableId: string;
  volumeSerialNumber?: number;
  fileIndex?: number;
  native?: boolean;
}

interface RustCoreResponse<Result> {
  request_id?: string;
  ok: boolean;
  result?: Result;
  error?: { code: string; message: string };
}

export interface RustCoreCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const executableName = platformService.isWindows ? "shanghao-core.exe" : "shanghao-core";

export class RustCoreClient {
  constructor(private readonly configuredExecutablePath?: string) {}

  static resolveExecutablePath(): string {
    if (app.isPackaged) return path.join(process.resourcesPath, "native", executableName);
    const workspaceRoot = path.resolve(app.getAppPath(), "../..");
    const releasePath = path.join(workspaceRoot, "native", "target", "release", executableName);
    if (existsSync(releasePath)) return releasePath;
    return path.join(workspaceRoot, "native", "target", "debug", executableName);
  }

  isAvailable(): boolean {
    return existsSync(this.executablePath);
  }

  capabilities(options?: RustCoreCallOptions): Promise<RustCoreCapabilities> {
    return this.call({ command: "capabilities" }, options);
  }

  activitySnapshot(options?: RustCoreCallOptions): Promise<RustActivitySnapshot> {
    return this.call({ command: "activity_snapshot" }, options);
  }

  fileIdentity(filePath: string, options?: RustCoreCallOptions): Promise<RustFileIdentity> {
    return this.call({ command: "file_identity", path: filePath }, options);
  }

  private async call<Result>(
    command: Record<string, unknown>,
    options: RustCoreCallOptions = {},
  ): Promise<Result> {
    if (!this.isAvailable()) throw new Error("rust_core_unavailable");
    const requestId = randomUUID();
    const { stdout } = await runLocalProcess(this.executablePath, [], {
      signal: options.signal,
      timeoutMs: Math.max(100, options.timeoutMs ?? 5_000),
      input: `${JSON.stringify({ ...command, request_id: requestId })}\n`,
    });
    const line = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean);
    if (!line) throw new Error("rust_core_empty_response");
    const response = JSON.parse(line) as RustCoreResponse<Result>;
    if (response.request_id !== requestId) throw new Error("rust_core_request_mismatch");
    if (!response.ok || response.result === undefined) {
      throw new Error(
        `${response.error?.code ?? "rust_core_failed"}: ${response.error?.message ?? ""}`,
      );
    }
    return response.result;
  }

  private get executablePath(): string {
    return this.configuredExecutablePath ?? RustCoreClient.resolveExecutablePath();
  }
}

export const rustCoreClient = new RustCoreClient();
