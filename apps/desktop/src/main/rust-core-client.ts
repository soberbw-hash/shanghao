import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { app } from "electron";

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

export interface RustActivityProcessSnapshot {
  available: boolean;
  processes: Array<{
    ProcessId: number;
    ProcessName: string;
    MainWindowTitle: string;
    Path?: string;
    ParentProcessId: number;
    IsForeground: boolean;
  }>;
}

export interface RustActivityProcessDetails {
  processes: Array<{ ProcessId: number; Path?: string }>;
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
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 3;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class RustCoreHostError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export class RustCoreClient {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<ChildProcessWithoutNullStreams>;
  private readonly pending = new Map<string, PendingRequest>();
  private outputBuffer = "";
  private outputDecoder = new StringDecoder("utf8");
  private writeQueue: Promise<void> = Promise.resolve();
  private restartTimes: number[] = [];
  private closing = false;

  constructor(
    private readonly configuredExecutablePath?: string,
    private readonly configuredArgs: string[] = [],
  ) {}

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

  activityProcessSnapshot(options?: RustCoreCallOptions): Promise<RustActivityProcessSnapshot> {
    return this.call({ command: "activity_process_snapshot" }, options);
  }

  activityProcessDetails(
    processIds: number[],
    options?: RustCoreCallOptions,
  ): Promise<RustActivityProcessDetails> {
    return this.call({ command: "activity_process_details", process_ids: processIds }, options);
  }

  fileIdentity(filePath: string, options?: RustCoreCallOptions): Promise<RustFileIdentity> {
    return this.call({ command: "file_identity", path: filePath }, options);
  }

  close(): void {
    this.closing = true;
    this.failPending(new RustCoreHostError("rust_core_closed"));
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    child.stdin.end();
    // A supervised native command must not survive app quit.
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 500);
    timer.unref();
  }

  private async call<Result>(
    command: Record<string, unknown>,
    options: RustCoreCallOptions = {},
  ): Promise<Result> {
    if (!this.isAvailable()) throw new Error("rust_core_unavailable");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.request<Result>(command, options);
      } catch (error) {
        if (
          attempt > 0 ||
          !(error instanceof RustCoreHostError && error.retryable) ||
          options.signal?.aborted
        ) {
          throw error;
        }
      }
    }
    throw new Error("rust_core_unavailable");
  }

  private async request<Result>(
    command: Record<string, unknown>,
    options: RustCoreCallOptions,
  ): Promise<Result> {
    if (this.closing) throw new RustCoreHostError("rust_core_closed");
    if (options.signal?.aborted) throw new RustCoreHostError("rust_core_aborted");
    const child = await this.ensureChild();
    const requestId = randomUUID();
    const line = `${JSON.stringify({ ...command, request_id: requestId })}\n`;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(
        () => this.terminateChild(child, new RustCoreHostError("rust_core_timeout")),
        Math.max(100, options.timeoutMs ?? 5_000),
      );
      const onAbort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        this.clearPending(pending);
        reject(new RustCoreHostError("rust_core_aborted"));
      };
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as Result),
        reject,
        timer,
        signal: options.signal,
        onAbort,
      });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.writeQueue = this.writeQueue
        .catch(() => undefined)
        .then(
          () =>
            new Promise<void>((resolve, reject) => {
              if (this.child !== child || child.stdin.destroyed) {
                reject(new RustCoreHostError("rust_core_exited", true));
                return;
              }
              child.stdin.write(line, (error) => (error ? reject(error) : resolve()));
            }),
        );
      void this.writeQueue.catch(() =>
        this.terminateChild(child, new RustCoreHostError("rust_core_write_failed", true)),
      );
    });
  }

  private async ensureChild(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    if (this.starting) return this.starting;
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((at) => now - at < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= MAX_RESTARTS_PER_WINDOW) {
      throw new RustCoreHostError("rust_core_restart_limit");
    }
    this.starting = new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.executablePath, this.configuredArgs, {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        reject(error);
        return;
      }
      this.child = child;
      this.outputBuffer = "";
      this.outputDecoder = new StringDecoder("utf8");
      child.stdout.on("data", (chunk: Buffer) => this.readOutput(child, chunk));
      child.stderr.resume();
      child.once("error", (error) => {
        this.terminateChild(
          child,
          new RustCoreHostError(`rust_core_spawn_failed: ${error.message}`),
        );
        reject(error);
      });
      child.once("close", () =>
        this.terminateChild(child, new RustCoreHostError("rust_core_exited", true)),
      );
      child.once("spawn", () => resolve(child));
    }).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private readOutput(child: ChildProcessWithoutNullStreams, chunk: Buffer): void {
    if (child !== this.child) return;
    this.outputBuffer += this.outputDecoder.write(chunk);
    if (Buffer.byteLength(this.outputBuffer, "utf8") > MAX_RESPONSE_BYTES) {
      this.terminateChild(child, new RustCoreHostError("rust_core_response_too_large"));
      return;
    }
    let newline = this.outputBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.outputBuffer.slice(0, newline).trim();
      this.outputBuffer = this.outputBuffer.slice(newline + 1);
      if (line) {
        let response: RustCoreResponse<unknown>;
        try {
          response = JSON.parse(line) as RustCoreResponse<unknown>;
        } catch {
          this.terminateChild(child, new RustCoreHostError("rust_core_invalid_response"));
          return;
        }
        const pending = response.request_id ? this.pending.get(response.request_id) : undefined;
        if (pending && response.request_id) {
          this.pending.delete(response.request_id);
          this.clearPending(pending);
          if (!response.ok || response.result === undefined) {
            pending.reject(
              new RustCoreHostError(
                `${response.error?.code ?? "rust_core_failed"}: ${response.error?.message ?? ""}`,
              ),
            );
          } else {
            pending.resolve(response.result);
          }
        }
      }
      newline = this.outputBuffer.indexOf("\n");
    }
  }

  private terminateChild(child: ChildProcessWithoutNullStreams, reason: RustCoreHostError): void {
    if (child !== this.child) return;
    this.child = undefined;
    this.outputBuffer = "";
    this.restartTimes.push(Date.now());
    this.failPending(reason);
    if (child.exitCode === null && !child.killed) child.kill();
  }

  private failPending(reason: RustCoreHostError): void {
    for (const pending of this.pending.values()) {
      this.clearPending(pending);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private clearPending(pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
  }

  private get executablePath(): string {
    return this.configuredExecutablePath ?? RustCoreClient.resolveExecutablePath();
  }
}

export const rustCoreClient = new RustCoreClient();
