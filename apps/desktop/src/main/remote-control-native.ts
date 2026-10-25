import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { NativeInputSink } from "./remote-control-session";
import type { RemoteControlNativeCommand } from "../../../../packages/shared/src/types/remote-control.types";

export interface RemoteInputWorkerCapabilities {
  supported: boolean;
  emergencyStopReady: boolean;
  dryRun: boolean;
}
interface Ack {
  ok: boolean;
  applied: boolean;
  dryRun: boolean;
  errorCode?: string;
}
interface Options {
  /** Main resolves this path; never accept an executable/arguments from renderer IPC. */
  executablePath: string;
  mode: "live" | "dry-run";
  onSafetyStop: (reason: string) => void;
  /** Dependency injection for protocol tests only; production uses fixed worker arguments. */
  spawnWorker?: typeof spawn;
}
interface Pending {
  resolve: (ack: Ack) => void;
  timer: NodeJS.Timeout;
}
interface Work {
  command: RemoteControlNativeCommand;
  queuedAt: number;
  resolve: (ack: Ack) => void;
}
const rejected = (reason: string, dryRun: boolean): Ack => ({
  ok: false,
  applied: false,
  dryRun,
  errorCode: reason,
});

/** Dedicated child and queue. No RustCoreClient retry or AI/process-supervision channel. */
export class RemoteControlNativeInput implements NativeInputSink {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<RemoteInputWorkerCapabilities>;
  private ready?: RemoteInputWorkerCapabilities;
  private readyResolve?: (capabilities: RemoteInputWorkerCapabilities) => void;
  private readyReject?: (error: Error) => void;
  private readonly pending = new Map<string, Pending>();
  private readonly queue: Work[] = [];
  private busy = false;
  private floor = 0;
  private current?: { grantId: string; generation: number };
  private heartbeat?: NodeJS.Timeout;
  private heartbeatPending = false;
  private terminal?: string;
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");

  constructor(private readonly options: Options) {}

  prepare(): Promise<RemoteInputWorkerCapabilities> {
    if (this.terminal) return Promise.reject(new Error(this.terminal));
    if (this.ready) return Promise.resolve({ ...this.ready });
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      const timeout = setTimeout(() => this.fail("native_ready_timeout"), 1500);
      const finish = () => clearTimeout(timeout);
      this.readyResolve = (capabilities) => {
        finish();
        resolve(capabilities);
      };
      this.readyReject = (error) => {
        finish();
        reject(error);
      };
      try {
        const child = (this.options.spawnWorker ?? spawn)(
          this.options.executablePath,
          [
            "--remote-input-worker",
            "--parent-pid",
            String(process.pid),
            this.options.mode === "dry-run" ? "--dry-run" : "--live",
          ],
          { windowsHide: true, stdio: "pipe", env: { ...process.env, RUST_BACKTRACE: "0" } },
        ) as ChildProcessWithoutNullStreams;
        this.child = child;
        child.stdin.on("error", () => this.fail("native_pipe_failed"));
        child.stdout.on("error", () => this.fail("native_pipe_failed"));
        child.stdout.on("data", (chunk: Buffer) => this.receive(this.decoder.write(chunk)));
        // Bound/discard diagnostics. Never forward raw worker output or input payloads.
        child.stderr.on("data", () => {});
        child.once("error", () => this.fail("native_worker_error"));
        child.once("exit", () => this.fail("native_worker_exit"));
      } catch {
        this.fail("native_worker_spawn_failed");
      }
    });
    return this.starting;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > 16384)
      return this.fail("native_response_too_large");
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      let response: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("shape");
        response = parsed as Record<string, unknown>;
      } catch {
        return this.fail("native_invalid_response");
      }
      if (response.kind === "ready") {
        const capabilities = {
          supported: response.supported === true,
          emergencyStopReady: response.emergencyStopReady === true,
          dryRun: response.dryRun === true,
        };
        if (
          response.protocolVersion !== 1 ||
          capabilities.dryRun !== (this.options.mode === "dry-run") ||
          (this.options.mode === "live" &&
            (!capabilities.supported || !capabilities.emergencyStopReady))
        )
          return this.fail("native_input_read_only");
        this.ready = capabilities;
        this.readyResolve?.({ ...capabilities });
        this.readyResolve = this.readyReject = undefined;
        continue;
      }
      if (response.kind === "fault" || response.kind === "revoked")
        return this.fail("native_safety_stop");
      if (typeof response.requestId !== "string") return this.fail("native_invalid_response");
      const request = this.pending.get(response.requestId);
      if (!request) continue;
      if (
        typeof response.ok !== "boolean" ||
        typeof response.applied !== "boolean" ||
        (response.dryRun === true && response.applied === true) ||
        response.dryRun !== (this.options.mode === "dry-run")
      )
        return this.fail("native_invalid_ack");
      this.pending.delete(response.requestId);
      clearTimeout(request.timer);
      request.resolve({ ok: response.ok, applied: response.applied, dryRun: response.dryRun });
    }
  }

  private request(command: Record<string, unknown>): Promise<Ack> {
    const dryRun = this.options.mode === "dry-run";
    if (!this.child || this.terminal)
      return Promise.resolve(rejected("native_unavailable", dryRun));
    if (this.pending.size >= 20 || this.child.stdin.writableLength > 32768) {
      this.fail("native_backpressure");
      return Promise.resolve(rejected("native_backpressure", dryRun));
    }
    const requestId = randomUUID();
    const line = JSON.stringify({ ...command, requestId }) + "\n";
    if (Buffer.byteLength(line, "utf8") > 8192)
      return Promise.resolve(rejected("native_input_too_large", dryRun));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.fail("native_ack_timeout");
      }, 180);
      this.pending.set(requestId, { resolve, timer });
      this.child!.stdin.write(line, (error) => {
        if (error) this.fail("native_pipe_failed");
      });
    });
  }

  async execute(command: RemoteControlNativeCommand): Promise<boolean> {
    const ack = await this.enqueue(command);
    return this.options.mode === "live" && ack.ok && ack.applied && !ack.dryRun;
  }
  /** Arms native local-priority hooks and its lease before advertising a grant. No input is injected. */
  async activateGrant(lease: { grantId: string; generation: number }): Promise<boolean> {
    await this.prepare();
    if (this.terminal || lease.generation <= this.floor) return false;
    if (this.current)
      return this.current.grantId === lease.grantId && this.current.generation === lease.generation;
    const ack = await this.request({ command: "begin", ...lease });
    if (!ack.ok || this.terminal || lease.generation <= this.floor) return false;
    this.current = { ...lease };
    this.startHeartbeat();
    return true;
  }

  /** Explicit simulation API, never exported to renderer or treated as OS execution. */
  async simulateForTest(command: RemoteControlNativeCommand): Promise<Ack> {
    if (this.options.mode !== "dry-run") throw new Error("native_simulation_requires_dry_run");
    return this.enqueue(command);
  }

  private enqueue(command: RemoteControlNativeCommand): Promise<Ack> {
    const dryRun = this.options.mode === "dry-run";
    if (
      this.terminal ||
      !/^[A-Za-z0-9-]{1,80}$/.test(command.grantId) ||
      !Number.isSafeInteger(command.generation) ||
      command.generation <= this.floor ||
      !command.event ||
      !["pointer", "button", "wheel", "key", "text"].includes(command.event.kind)
    )
      return Promise.resolve(rejected("native_invalid_command", dryRun));
    if (this.queue.length + Number(this.busy) >= 16)
      return Promise.resolve(rejected("native_queue_full", dryRun));
    return new Promise((resolve) => {
      this.queue.push({ command: structuredClone(command), queuedAt: performance.now(), resolve });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    const work = this.queue.shift();
    if (!work) return;
    this.busy = true;
    try {
      await this.prepare();
      const command = work.command;
      if (command.generation <= this.floor || this.terminal) {
        work.resolve(rejected("native_invalidated", this.options.mode === "dry-run"));
        return;
      }
      if (performance.now() - work.queuedAt > 200) {
        this.fail("native_queue_expired");
        work.resolve(rejected("native_queue_expired", this.options.mode === "dry-run"));
        return;
      }
      if (!this.current) {
        const begun = await this.request({
          command: "begin",
          grantId: command.grantId,
          generation: command.generation,
        });
        if (!begun.ok || command.generation <= this.floor || this.terminal) {
          work.resolve(rejected("native_begin_failed", this.options.mode === "dry-run"));
          return;
        }
        this.current = { grantId: command.grantId, generation: command.generation };
        this.startHeartbeat();
      }
      if (
        this.current.grantId !== command.grantId ||
        this.current.generation !== command.generation
      ) {
        work.resolve(rejected("native_controller_busy", this.options.mode === "dry-run"));
        return;
      }
      const ack = await this.request({
        command: "input",
        grantId: command.grantId,
        generation: command.generation,
        event: command.event,
      });
      work.resolve(
        command.generation <= this.floor
          ? rejected("native_invalidated", this.options.mode === "dry-run")
          : ack,
      );
    } catch {
      work.resolve(rejected("native_unavailable", this.options.mode === "dry-run"));
    } finally {
      this.busy = false;
      void this.pump();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const lease = this.current;
      if (!lease || this.terminal || this.heartbeatPending) return;
      this.heartbeatPending = true;
      void this.request({ command: "heartbeat", ...lease })
        .then((ack) => {
          if (!ack.ok && this.current === lease) this.fail("native_lease_lost");
        })
        .finally(() => {
          this.heartbeatPending = false;
        });
    }, 200);
    this.heartbeat.unref();
  }

  invalidateAndRelease(lease: Parameters<NativeInputSink["invalidateAndRelease"]>[0]): void {
    if (
      !Number.isSafeInteger(lease.generation) ||
      lease.generation < 1 ||
      !/^[A-Za-z0-9-]{1,80}$/.test(lease.grantId)
    ) {
      this.fail("native_invalid_revoke");
      return;
    }
    this.floor = Math.max(this.floor, lease.generation);
    if (this.current && this.current.generation <= this.floor) this.current = undefined;
    for (const work of this.queue.splice(0))
      work.resolve(rejected("native_invalidated", this.options.mode === "dry-run"));
    // Priority protocol bypasses the ordinary event queue. Rust invalidates before dequeue.
    if (this.child && !this.terminal)
      void this.request({
        command: "revoke",
        grantId: lease.grantId,
        generation: lease.generation,
      }).then((ack) => {
        if (!ack.ok) this.fail("native_release_failed");
      });
  }

  private fail(reason: string): void {
    if (this.terminal) return;
    this.terminal = reason;
    this.current = undefined;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.readyReject?.(new Error(reason));
    this.readyResolve = this.readyReject = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.resolve(rejected(reason, this.options.mode === "dry-run"));
    }
    this.pending.clear();
    for (const work of this.queue.splice(0))
      work.resolve(rejected(reason, this.options.mode === "dry-run"));
    // EOF triggers native-owned release; allow its independent lease/cleanup watchdog first.
    const child = this.child;
    if (child) {
      child.stdin.end();
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill();
      }, 1500);
      timer.unref();
    }
    try {
      this.options.onSafetyStop(reason);
    } catch {
      /* Cleanup must not depend on an observer. */
    }
  }

  dispose(): void {
    this.fail("native_owner_closed");
  }
}
