import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AiAsrModelId } from "@private-voice/shared";

import { platformService } from "./platform/PlatformService";

export type AsrWorkerPhase = "stopped" | "starting" | "loading" | "ready" | "running" | "crashed";

export interface AsrWorkerSegment {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
  words?: Array<{ startMs: number; endMs: number; text: string }>;
}

export interface AsrWorkerResult {
  text: string;
  segments?: AsrWorkerSegment[];
}

export interface AsrWorkerHealth {
  phase: AsrWorkerPhase;
  loaded: boolean;
  modelId?: AiAsrModelId;
  processId?: number;
  queuedJobs: number;
  activeJobId?: string;
  lastError?: string;
  diagnosticDetail?: string;
}

export interface AsrWorkerLaunch {
  modelId: AiAsrModelId;
  modelPath: string;
  alignerModelPath?: string;
  vadModelPath?: string;
  puncModelPath?: string;
  pythonPath?: string;
}

interface AsrWorkerRequest {
  id: string;
  launch: AsrWorkerLaunch;
  wavPath: string;
  durationMs: number;
  resourceMode: "low" | "normal";
  timeoutMs: number;
  signal?: AbortSignal;
  resolve: (value: AsrWorkerResult) => void;
  reject: (reason: Error) => void;
  abort?: () => void;
  timeout?: NodeJS.Timeout;
}

interface WorkerMessage {
  type?: "loading" | "ready" | "result" | "error";
  id?: string;
  output?: AsrWorkerResult;
  error?: string;
}

const WORKER_LOAD_TIMEOUT_MS = 8 * 60_000;
const WORKER_IDLE_RELEASE_MS = 60_000;
const STDERR_LIMIT = 16_384;

const launchKey = (launch: AsrWorkerLaunch): string =>
  [
    launch.modelId,
    launch.modelPath,
    launch.alignerModelPath,
    launch.vadModelPath,
    launch.puncModelPath,
  ].join("|");

const killProcessTree = (child: ChildProcessWithoutNullStreams): void => {
  if (platformService.isWindows && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
    return;
  }
  child.kill("SIGKILL");
};

/** Keeps exactly one non-Vibe ASR model loaded and serializes inference off the Electron thread. */
export class AsrPersistentWorker {
  private child?: ChildProcessWithoutNullStreams;
  private phase: AsrWorkerPhase = "stopped";
  private currentLaunch?: AsrWorkerLaunch;
  private stdoutBuffer = "";
  private stderrTail = "";
  private queue: AsrWorkerRequest[] = [];
  private active?: AsrWorkerRequest;
  private startPromise?: Promise<void>;
  private startResolve?: () => void;
  private startReject?: (reason: Error) => void;
  private loadTimeout?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private lastError?: string;
  private diagnosticDetail?: string;

  constructor(
    private readonly pythonExecutable: string,
    private readonly runnerPath: string,
    private readonly idleReleaseMs = WORKER_IDLE_RELEASE_MS,
  ) {}

  health(): AsrWorkerHealth {
    return {
      phase: this.phase,
      loaded: this.phase === "ready" || this.phase === "running",
      modelId: this.currentLaunch?.modelId,
      processId: this.child?.pid,
      queuedJobs: this.queue.length,
      activeJobId: this.active?.id,
      lastError: this.lastError,
      diagnosticDetail: this.diagnosticDetail,
    };
  }

  run(options: {
    launch: AsrWorkerLaunch;
    wavPath: string;
    durationMs: number;
    resourceMode: "low" | "normal";
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<AsrWorkerResult> {
    if (options.signal?.aborted) return Promise.reject(new Error("ai_task_paused"));
    this.clearIdleRelease();
    return new Promise<AsrWorkerResult>((resolve, reject) => {
      const request: AsrWorkerRequest = {
        id: randomUUID(),
        ...options,
        resolve,
        reject,
      };
      request.abort = () => this.cancelRequest(request);
      options.signal?.addEventListener("abort", request.abort, { once: true });
      this.queue.push(request);
      void this.pump();
    });
  }

  release(reason = "released"): void {
    this.clearIdleRelease();
    const error = new Error(
      reason === "idle_timeout" ? "asr_worker_idle_release" : "ai_task_paused",
    );
    if (this.active) this.finishRequest(this.active, error);
    for (const request of this.queue.splice(0)) this.finishRequest(request, error);
    this.stopChild(error);
  }

  private async pump(): Promise<void> {
    if (this.active || !this.queue.length) return;
    const request = this.queue[0];
    if (!request) return;
    try {
      await this.ensureStarted(request.launch);
    } catch (error) {
      this.queue.shift();
      this.finishRequest(request, error instanceof Error ? error : new Error(String(error)));
      if (this.queue.length) void this.pump();
      return;
    }
    if (this.active || !this.child || this.phase !== "ready") return;
    this.queue.shift();
    if (request.signal?.aborted) {
      this.finishRequest(request, new Error("ai_task_paused"));
      void this.pump();
      return;
    }
    this.active = request;
    this.phase = "running";
    request.timeout = setTimeout(() => {
      if (this.active !== request) return;
      const error = new Error(`asr_worker_timeout:${request.timeoutMs}ms`);
      this.lastError = error.message;
      this.finishRequest(request, error);
      this.stopChild(error);
      if (this.queue.length) void this.pump();
    }, request.timeoutMs);
    this.child.stdin.write(
      `${JSON.stringify({
        id: request.id,
        wavPath: request.wavPath,
        durationMs: request.durationMs,
        resourceMode: request.resourceMode,
      })}\n`,
      "utf8",
    );
  }

  private ensureStarted(launch: AsrWorkerLaunch): Promise<void> {
    this.clearIdleRelease();
    if (this.child && launchKey(this.currentLaunch as AsrWorkerLaunch) === launchKey(launch)) {
      if (this.phase === "ready" || this.phase === "running") return Promise.resolve();
      if (this.startPromise) return this.startPromise;
    }
    if (this.child) this.stopChild(new Error("asr_model_changed"));
    this.phase = "starting";
    this.lastError = undefined;
    this.diagnosticDetail = undefined;
    this.stdoutBuffer = "";
    this.stderrTail = "";
    this.currentLaunch = launch;
    const args = [
      this.runnerPath,
      "--worker",
      "--provider",
      launch.modelId,
      "--model",
      launch.modelPath,
    ];
    if (launch.vadModelPath) args.push("--vad-model", launch.vadModelPath);
    if (launch.puncModelPath) args.push("--punc-model", launch.puncModelPath);
    if (launch.alignerModelPath) args.push("--aligner-model", launch.alignerModelPath);
    const child = spawn(this.pythonExecutable, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONPATH: launch.pythonPath
          ? `${launch.pythonPath};${process.env.PYTHONPATH ?? ""}`
          : process.env.PYTHONPATH,
      },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-STDERR_LIMIT);
    });
    child.on("error", (error) => {
      if (this.child === child) this.handleCrash(error);
    });
    child.on("close", (code) => {
      if (this.child === child) {
        this.handleCrash(new Error(`asr_worker_exit_${code}: ${this.stderrTail.slice(-800)}`));
      }
    });
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      this.loadTimeout = setTimeout(
        () => this.handleCrash(new Error("asr_worker_load_timeout")),
        WORKER_LOAD_TIMEOUT_MS,
      );
    });
    return this.startPromise;
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let lineEnd = this.stdoutBuffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = this.stdoutBuffer.slice(0, lineEnd).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
      if (line) this.consumeMessage(line);
      lineEnd = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeMessage(line: string): void {
    let message: WorkerMessage;
    try {
      message = JSON.parse(line) as WorkerMessage;
    } catch {
      this.stderrTail = `${this.stderrTail}\n[unexpected stdout] ${line}`.slice(-STDERR_LIMIT);
      return;
    }
    if (message.type === "loading") {
      this.phase = "loading";
      return;
    }
    if (message.type === "ready") {
      this.phase = "ready";
      if (this.loadTimeout) clearTimeout(this.loadTimeout);
      this.loadTimeout = undefined;
      this.startResolve?.();
      this.startPromise = undefined;
      this.startResolve = undefined;
      this.startReject = undefined;
      return;
    }
    const request = this.active;
    if (!request || message.id !== request.id) return;
    if (message.type === "error") {
      const error = message.error ?? "asr_runtime_failed";
      this.lastError = error;
      this.diagnosticDetail = `${error}\n${this.stderrTail}`.trim();
      this.finishRequest(request, new Error(error));
    } else if (message.type === "result") {
      this.finishRequest(request, undefined, message.output ?? { text: "" });
    }
    this.phase = "ready";
    this.scheduleIdleRelease();
    void this.pump();
  }

  private cancelRequest(request: AsrWorkerRequest): void {
    if (this.active === request) {
      const error = new Error("ai_task_paused");
      this.finishRequest(request, error);
      this.stopChild(error);
      if (this.queue.length) void this.pump();
      return;
    }
    const index = this.queue.indexOf(request);
    if (index >= 0) this.queue.splice(index, 1);
    this.finishRequest(request, new Error("ai_task_paused"));
  }

  private finishRequest(request: AsrWorkerRequest, error?: Error, output?: AsrWorkerResult): void {
    if (request.timeout) clearTimeout(request.timeout);
    request.signal?.removeEventListener("abort", request.abort as EventListener);
    if (this.active === request) this.active = undefined;
    if (error) request.reject(error);
    else request.resolve(output ?? { text: "" });
  }

  private handleCrash(error: Error): void {
    this.lastError = error.message;
    this.diagnosticDetail = `${error.stack ?? error.message}\n${this.stderrTail}`.trim();
    this.phase = "crashed";
    if (this.active) this.finishRequest(this.active, error);
    this.stopChild(error, true);
    this.phase = "crashed";
    if (this.queue.length) void this.pump();
  }

  private stopChild(error: Error, preserveError = false): void {
    this.clearIdleRelease();
    if (this.loadTimeout) clearTimeout(this.loadTimeout);
    this.loadTimeout = undefined;
    this.startReject?.(error);
    this.startPromise = undefined;
    this.startResolve = undefined;
    this.startReject = undefined;
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) killProcessTree(child);
    this.stdoutBuffer = "";
    this.stderrTail = "";
    if (!preserveError) {
      this.phase = "stopped";
      this.currentLaunch = undefined;
    }
  }

  private scheduleIdleRelease(): void {
    this.clearIdleRelease();
    if (this.active || this.queue.length) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.active || this.queue.length) return;
      this.release("idle_timeout");
    }, this.idleReleaseMs);
  }

  private clearIdleRelease(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}
