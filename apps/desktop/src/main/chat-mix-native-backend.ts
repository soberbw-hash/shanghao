import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ChatMixSession,
  ChatMixSessionId,
  ChatMixVolumeBackend,
} from "./chat-mix-volume-leases";

/** Private Main-owned pipe, one in-flight command. Failed mutations are never replayed here. */
export class NativeChatMixBackend implements ChatMixVolumeBackend {
  private child?: ChildProcessWithoutNullStreams;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private heartbeat?: ReturnType<typeof setInterval>;
  private retiring: Promise<void> = Promise.resolve();
  private pending?: {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(private readonly executable: string) {}

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }
  private fail(error: Error): void {
    const child = this.child;
    this.child = undefined;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    if (child) this.retiring = this.finish(child, false);
  }
  private finish(child: ChildProcessWithoutNullStreams, graceful: boolean): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid)
      return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => child.kill(), graceful ? 3500 : 0);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (graceful) child.stdin.end();
    });
  }
  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(this.executable, ["--pipe"], { windowsHide: true, stdio: "pipe" });
    this.child = child;
    let buffered = "";
    child.stderr.on("data", () => {
      /* Never copy native session identities into diagnostics. */
    });
    child.stdin.on("error", () => {
      if (this.child === child) this.fail(Error("chat_mix_native_closed"));
    });
    child.stdout.on("error", () => {
      if (this.child === child) this.fail(Error("chat_mix_native_closed"));
    });
    child.on("error", () => {
      if (this.child === child) this.fail(Error("chat_mix_native_unavailable"));
    });
    child.on("exit", () => {
      if (this.child === child) this.fail(Error("chat_mix_native_closed"));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      buffered += chunk;
      if (Buffer.byteLength(buffered) > 2 * 1024 * 1024) {
        this.fail(Error("chat_mix_native_invalid_response"));
        return;
      }
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        const pending = this.pending;
        if (!pending) {
          this.fail(Error("chat_mix_native_invalid_response"));
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          this.fail(Error("chat_mix_native_invalid_response"));
          return;
        }
        this.pending = undefined;
        clearTimeout(pending.timer);
        pending.resolve(value);
      }
    });
    this.heartbeat = setInterval(() => {
      // Do not accumulate ping work behind a slow COM operation.
      if (this.pending || this.disposed || this.child !== child) return;
      void this.ask({ command: "ping" }).catch(() => undefined);
    }, 2000);
    this.heartbeat.unref();
    return child;
  }
  private ask(input: object): Promise<unknown> {
    const work = this.queue.then(async () => {
      if (this.disposed) throw Error("chat_mix_native_closed");
      let retirementDeadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.retiring,
          new Promise<never>((_resolve, reject) => {
            retirementDeadline = setTimeout(() => reject(Error("chat_mix_native_closed")), 5000);
          }),
        ]);
      } finally {
        clearTimeout(retirementDeadline);
      }
      if (this.disposed) throw Error("chat_mix_native_closed");
      const data = JSON.stringify(input);
      if (Buffer.byteLength(data) > 16_384) throw Error("chat_mix_invalid_command");
      const child = this.start();
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => this.fail(Error("chat_mix_native_timeout")), 3000);
        this.pending = { resolve, reject, timer };
        child.stdin.write(data + "\n", (error) => {
          if (error && this.child === child) this.fail(Error("chat_mix_native_closed"));
        });
      });
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  async list(): Promise<ChatMixSession[]> {
    const value = await this.ask({ command: "list" });
    if (
      !Array.isArray(value) ||
      value.length > 512 ||
      value.some(
        (session) =>
          !session ||
          typeof session.deviceId !== "string" ||
          !session.deviceId ||
          session.deviceId.length > 1024 ||
          typeof session.instanceId !== "string" ||
          !session.instanceId ||
          session.instanceId.length > 4096 ||
          !Number.isSafeInteger(session.processId) ||
          session.processId <= 0 ||
          typeof session.muted !== "boolean" ||
          !Number.isFinite(session.volume) ||
          session.volume < 0 ||
          session.volume > 1,
      )
    )
      throw Error("chat_mix_native_invalid_response");
    return value as ChatMixSession[];
  }
  async change(
    session: ChatMixSessionId,
    expected: number,
    value: number,
    original = expected,
  ): Promise<{ ok: boolean; conflict?: boolean }> {
    const result = await this.ask({ ...session, expected, value, original });
    if (
      !result ||
      typeof result !== "object" ||
      !("ok" in result) ||
      typeof result.ok !== "boolean"
    )
      throw Error("chat_mix_native_invalid_response");
    if ("error" in result) throw Error("chat_mix_native_unavailable");
    return { ok: result.ok, conflict: "conflict" in result && result.conflict === true };
  }
  async close(): Promise<void> {
    this.disposed = true;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const child = this.child;
    this.child = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(Error("chat_mix_native_closed"));
    }
    if (child) this.retiring = this.finish(child, true);
    await this.retiring;
  }
  dispose(): void {
    void this.close();
  }
}
