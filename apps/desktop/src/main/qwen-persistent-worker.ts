import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { platformService } from "./platform/PlatformService";

export type QwenWorkerPhase = "stopped" | "starting" | "loading" | "ready" | "running" | "crashed";

export interface QwenWorkerHealth {
  phase: QwenWorkerPhase;
  loaded: boolean;
  processId?: number;
  queuedJobs: number;
  activeJobId?: string;
  lastError?: string;
  lastUsedAt?: number;
}

interface QwenWorkerRequest {
  id: string;
  prompt: string;
  maxNewTokens: number;
  resourceMode: "low" | "normal";
  timeoutMs: number;
  signal?: AbortSignal;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  abort?: () => void;
  timeout?: NodeJS.Timeout;
}

interface WorkerMessage {
  type?: "loading" | "ready" | "result" | "error";
  id?: string;
  output?: string;
  error?: string;
}

const WORKER_LOAD_TIMEOUT_MS = 8 * 60_000;
const WORKER_IDLE_RELEASE_MS = 90_000;
const STDERR_LIMIT = 16_384;

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

/** Owns the only Qwen model process and serializes every request through it. */
export class QwenPersistentWorker {
  private child?: ChildProcessWithoutNullStreams;
  private phase: QwenWorkerPhase = "stopped";
  private stdoutBuffer = "";
  private stderrTail = "";
  private queue: QwenWorkerRequest[] = [];
  private active?: QwenWorkerRequest;
  private startPromise?: Promise<void>;
  private startResolve?: () => void;
  private startReject?: (reason: Error) => void;
  private loadTimeout?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private lastError?: string;
  private lastUsedAt?: number;
  private readonly listeners = new Set<(health: QwenWorkerHealth) => void>();

  constructor(
    private readonly pythonExecutable: string,
    private readonly runnerPath: string,
    private readonly modelPath: () => string | undefined,
  ) {}

  onState(listener: (health: QwenWorkerHealth) => void): () => void {
    this.listeners.add(listener);
    listener(this.health());
    return () => this.listeners.delete(listener);
  }

  health(): QwenWorkerHealth {
    return {
      phase: this.phase,
      loaded: this.phase === "ready" || this.phase === "running",
      processId: this.child?.pid,
      queuedJobs: this.queue.length,
      activeJobId: this.active?.id,
      lastError: this.lastError,
      lastUsedAt: this.lastUsedAt,
    };
  }

  async run(options: {
    prompt: string;
    maxNewTokens: number;
    resourceMode: "low" | "normal";
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<string> {
    if (options.signal?.aborted) throw new Error("ai_task_paused");
    return new Promise<string>((resolve, reject) => {
      const request: QwenWorkerRequest = {
        id: randomUUID(),
        prompt: options.prompt,
        maxNewTokens: options.maxNewTokens,
        resourceMode: options.resourceMode,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        resolve,
        reject,
      };
      request.abort = () => this.cancelRequest(request);
      options.signal?.addEventListener("abort", request.abort, { once: true });
      this.queue.push(request);
      this.emit();
      void this.pump();
    });
  }

  load(): Promise<void> {
    return this.ensureStarted();
  }

  cancel(jobId: string): boolean {
    if (this.active?.id === jobId) {
      this.cancelRequest(this.active);
      return true;
    }
    const request = this.queue.find((candidate) => candidate.id === jobId);
    if (!request) return false;
    this.cancelRequest(request);
    return true;
  }

  release(reason = "released"): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const error = new Error(
      reason === "idle_timeout" ? "qwen_worker_idle_release" : "ai_task_paused",
    );
    if (this.active) this.finishRequest(this.active, error);
    for (const request of this.queue.splice(0)) this.finishRequest(request, error);
    if (this.child) killProcessTree(this.child);
    this.child = undefined;
    this.failStart(error);
    this.phase = "stopped";
    this.stdoutBuffer = "";
    this.stderrTail = "";
    this.emit();
  }

  private async pump(): Promise<void> {
    if (this.active || !this.queue.length) return;
    try {
      await this.ensureStarted();
    } catch (error) {
      const first = this.queue.shift();
      if (first)
        this.finishRequest(first, error instanceof Error ? error : new Error(String(error)));
      if (this.queue.length) void this.pump();
      return;
    }
    if (this.active || !this.child || this.phase !== "ready") return;
    const request = this.queue.shift();
    if (!request) return;
    if (request.signal?.aborted) {
      this.finishRequest(request, new Error("ai_task_paused"));
      void this.pump();
      return;
    }
    this.active = request;
    this.phase = "running";
    this.lastUsedAt = Date.now();
    request.timeout = setTimeout(() => {
      if (this.active !== request) return;
      const error = new Error("qwen_worker_timeout");
      this.finishRequest(request, error);
      this.restartAfterCancellation(error);
    }, request.timeoutMs);
    this.emit();
    this.child.stdin.write(
      `${JSON.stringify({
        id: request.id,
        prompt: request.prompt,
        maxNewTokens: request.maxNewTokens,
        resourceMode: request.resourceMode,
      })}\n`,
      "utf8",
    );
  }

  private ensureStarted(): Promise<void> {
    if (this.child && (this.phase === "ready" || this.phase === "running"))
      return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    const modelPath = this.modelPath();
    if (!modelPath) return Promise.reject(new Error("model_qwen35-4b_not_installed"));
    this.phase = "starting";
    this.lastError = undefined;
    this.stdoutBuffer = "";
    this.stderrTail = "";
    const child = spawn(
      this.pythonExecutable,
      [this.runnerPath, "--worker", "--model", modelPath],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      },
    );
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
      if (this.child === child)
        this.handleCrash(new Error(`qwen_worker_exit_${code}: ${this.stderrTail.slice(-800)}`));
    });
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      this.loadTimeout = setTimeout(
        () => this.handleCrash(new Error("qwen_worker_load_timeout")),
        WORKER_LOAD_TIMEOUT_MS,
      );
    });
    this.emit();
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
      this.emit();
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
      this.emit();
      return;
    }
    const request = this.active;
    if (!request || message.id !== request.id) return;
    if (message.type === "error") {
      this.finishRequest(
        request,
        new Error(`qwen_worker_job_failed: ${message.error ?? "unknown"}`),
      );
    } else if (message.type === "result") {
      this.finishRequest(request, undefined, message.output ?? "");
    }
    this.phase = "ready";
    this.lastUsedAt = Date.now();
    this.emit();
    this.scheduleIdleRelease();
    void this.pump();
  }

  private cancelRequest(request: QwenWorkerRequest): void {
    if (this.active === request) {
      const error = new Error("ai_task_paused");
      this.finishRequest(request, error);
      this.restartAfterCancellation(error);
      return;
    }
    const index = this.queue.indexOf(request);
    if (index >= 0) this.queue.splice(index, 1);
    this.finishRequest(request, new Error("ai_task_paused"));
    this.emit();
  }

  private finishRequest(request: QwenWorkerRequest, error?: Error, output?: string): void {
    if (request.timeout) clearTimeout(request.timeout);
    request.signal?.removeEventListener("abort", request.abort as EventListener);
    if (this.active === request) this.active = undefined;
    if (error) request.reject(error);
    else request.resolve(output ?? "");
  }

  private handleCrash(error: Error): void {
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) killProcessTree(child);
    this.lastError = error.message;
    this.phase = "crashed";
    this.stdoutBuffer = "";
    this.failStart(error);
    if (this.active) this.finishRequest(this.active, error);
    this.emit();
    if (this.queue.length) void this.pump();
  }

  private restartAfterCancellation(error: Error): void {
    const child = this.child;
    this.child = undefined;
    if (child) killProcessTree(child);
    this.phase = "stopped";
    this.stdoutBuffer = "";
    this.failStart(error);
    this.emit();
    if (this.queue.length) void this.pump();
  }

  private failStart(error: Error): void {
    if (this.loadTimeout) clearTimeout(this.loadTimeout);
    this.loadTimeout = undefined;
    this.startReject?.(error);
    this.startPromise = undefined;
    this.startResolve = undefined;
    this.startReject = undefined;
  }

  private scheduleIdleRelease(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.active || this.queue.length) return;
    this.idleTimer = setTimeout(() => this.release("idle_timeout"), WORKER_IDLE_RELEASE_MS);
  }

  private emit(): void {
    const health = this.health();
    for (const listener of this.listeners) listener(health);
  }
}
